import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { safeFetch, SsrfError } from "@/lib/url/ssrf";
import { fetchRobots } from "./robots";
import { fetchSitemapUrls } from "./sitemap";
import type { CrawlOptions, CrawledPage, CrawlResult } from "./types";

const DEFAULT_UA = "llms-txt-bot/1.0 (+https://llmstxt.app/bot)";

const DEFAULTS: Required<CrawlOptions> = {
  maxPages: 30,
  hardCeiling: 150,
  maxDepth: 3,
  concurrency: 6,
  requestTimeoutMs: 5_000,
  politeDelayMs: 500,
  userAgent: DEFAULT_UA,
};

// Hard wall on total crawl time — return whatever pages we have if exceeded.
const CRAWL_TIME_BUDGET_MS = 60_000;

export async function crawl(
  originUrl: string,
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const cfg = { ...DEFAULTS, ...opts };
  const origin = new URL(originUrl).origin;

  const robots = await fetchRobots(origin);
  const effectiveDelay = Math.max(cfg.politeDelayMs, robots.crawlDelayMs);
  const limit = pLimit(cfg.concurrency);

  // Seed from sitemap
  const sitemapCandidates = [...robots.sitemapUrls];
  if (!sitemapCandidates.length) {
    sitemapCandidates.push(`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`);
  }

  let sitemapUrls: string[] = [];
  for (const su of sitemapCandidates) {
    try {
      const found = await fetchSitemapUrls(su, origin);
      sitemapUrls.push(...found);
    } catch {
      // ignore per-sitemap errors
    }
  }
  sitemapUrls = [...new Set(sitemapUrls)];
  const sitemapUsed = sitemapUrls.length > 0;

  // BFS queue: [url, depth]
  const queue: Array<[string, number]> = [];
  const enqueued = new Set<string>();

  const enqueue = (url: string, depth: number) => {
    const normalised = canonicalise(url);
    if (!normalised) return;
    if (!sameEffectiveOrigin(normalised, origin)) return;
    if (enqueued.has(normalised)) return;
    enqueued.add(normalised);
    queue.push([normalised, depth]);
  };

  enqueue(originUrl, 0);
  // Seed sitemap URLs at depth 2 so homepage-discovered nav links (depth 1)
  // are always processed first — they reflect the site's actual structure.
  for (const u of sitemapUrls) enqueue(u, 2);

  const pages: CrawledPage[] = [];
  const errors: Array<{ url: string; reason: string }> = [];
  let pagesSkipped = 0;
  let lastRequestTime = 0;
  const deadline = Date.now() + CRAWL_TIME_BUDGET_MS;

  while (queue.length > 0 && pages.length < cfg.hardCeiling) {
    if (pages.length >= cfg.maxPages) break;
    if (Date.now() > deadline) break;

    // Process shallowest pages first so homepage nav links (depth 1) are
    // visited before sitemap-seeded URLs (depth 2).
    queue.sort((a, b) => a[1] - b[1]);
    const batch = queue.splice(0, cfg.concurrency);

    const tasks = batch.map(([url, depth]) =>
      limit(async (): Promise<void> => {
        if (!robots.isAllowed(url)) {
          pagesSkipped++;
          return;
        }

        const now = Date.now();
        const wait = effectiveDelay - (now - lastRequestTime);
        if (wait > 0) await sleep(wait);
        lastRequestTime = Date.now();

        let res: Response;
        try {
          res = await safeFetch(url, {
            headers: { "User-Agent": cfg.userAgent },
            signal: AbortSignal.timeout(cfg.requestTimeoutMs),
          });
        } catch (err) {
          if (err instanceof SsrfError) {
            pagesSkipped++;
          } else {
            errors.push({ url, reason: String(err) });
          }
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) {
          pagesSkipped++;
          return;
        }

        const html = await res.text();
        const finalUrl = res.url || url;

        pages.push({ url, depth, statusCode: res.status, html, finalUrl });

        if (depth < cfg.maxDepth) {
          const links = extractLinks(html, finalUrl, origin);
          for (const link of links) enqueue(link, depth + 1);
        }
      }),
    );

    await Promise.all(tasks);
  }

  pagesSkipped += queue.length;

  return {
    pages,
    pagesFound: enqueued.size,
    pagesCrawled: pages.length,
    pagesSkipped,
    sitemapUsed,
    errors,
  };
}

// Accepts www <-> non-www redirect pairs as same-origin.
function sameEffectiveOrigin(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    if (u.protocol !== o.protocol) return false;
    const uh = u.hostname;
    const oh = o.hostname;
    return uh === oh || uh === `www.${oh}` || `www.${uh}` === oh;
  } catch {
    return false;
  }
}

function canonicalise(href: string): string | null {
  try {
    const u = new URL(href);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function extractLinks(html: string, baseUrl: string, origin: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      const resolved = new URL(href, baseUrl).toString();
      if (sameEffectiveOrigin(resolved, origin)) links.push(resolved);
    } catch {
      // ignore unparseable hrefs
    }
  });
  return links;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
