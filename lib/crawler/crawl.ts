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
  requestTimeoutMs: 8_000,
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

  // Per-depth buckets: O(1) enqueue, O(1) dequeue, no large-array shifts or sorts.
  // Depth 0 = homepage, 1 = nav links discovered from homepage, 2 = sitemap seeds.
  const buckets: Map<number, Array<[string, number]>> = new Map();
  const enqueued = new Set<string>();

  const enqueue = (url: string, depth: number) => {
    const normalised = canonicalise(url);
    if (!normalised) return;
    if (!sameEffectiveOrigin(normalised, origin)) return;
    if (enqueued.has(normalised)) return;
    enqueued.add(normalised);
    if (!buckets.has(depth)) buckets.set(depth, []);
    buckets.get(depth)!.push([normalised, depth]);
  };

  // Drain the shallowest non-empty bucket, filling the batch.
  const nextBatch = (n: number): Array<[string, number]> => {
    const depths = [...buckets.keys()].sort((a, b) => a - b);
    const batch: Array<[string, number]> = [];
    for (const d of depths) {
      const bucket = buckets.get(d)!;
      while (batch.length < n && bucket.length > 0) {
        batch.push(bucket.shift()!);
      }
      if (bucket.length === 0) buckets.delete(d);
      if (batch.length === n) break;
    }
    return batch;
  };

  const hasMore = () => buckets.size > 0;

  enqueue(originUrl, 0);
  // Seed sitemap URLs at depth 2 so homepage nav links (depth 1) are always
  // processed first — they reflect the site's actual navigation structure.
  for (const u of sitemapUrls) enqueue(u, 2);

  const pages: CrawledPage[] = [];
  const errors: Array<{ url: string; reason: string }> = [];
  let pagesSkipped = 0;
  let lastRequestTime = 0;
  const deadline = Date.now() + CRAWL_TIME_BUDGET_MS;

  while (hasMore() && pages.length < cfg.hardCeiling) {
    if (pages.length >= cfg.maxPages) break;
    if (Date.now() > deadline) break;

    const batch = nextBatch(cfg.concurrency);

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
          // Either way the page wasn't crawled, so it counts as skipped. Non-SSRF
          // failures are additionally recorded in errors[] for structured logging.
          pagesSkipped++;
          if (!(err instanceof SsrfError)) {
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

  pagesSkipped += [...buckets.values()].reduce((s, b) => s + b.length, 0);

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
