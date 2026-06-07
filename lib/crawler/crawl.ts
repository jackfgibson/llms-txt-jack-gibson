import * as cheerio from "cheerio";
import { SsrfError } from "@/lib/url/ssrf";
import { fetchPage } from "./fetcher";
import { normalizeUrl, visitedKey, sameDomain } from "./normalize";
import {
  extractPageMeta,
  extractMainContent,
  collectFollowLinks,
  isJavascriptRendered,
} from "./parse";
import type {
  CrawlOptions,
  CrawledPage,
  CrawlResult,
  FailedPage,
} from "./types";

// HOW_TO_CRAWL.md §4 — a depth-bounded, page-bounded, same-domain crawl.
// Recursive with batched parallelism (a bounded BFS/DFS hybrid). Single-threaded
// async, so each "critical section" below is naturally atomic: all shared-state
// checks + mutations happen synchronously before the next await.

const DEFAULTS: Required<CrawlOptions> = {
  maxPages: 20, // DEFAULT_MAX_PAGES
  maxDepth: 3, // DEFAULT_MAX_DEPTH
  concurrency: 4, // CONCURRENCY — fetches per follow-link batch
  userAgent: "llms-txt-fetcher/0.1",
  requestTimeoutMs: 30_000,
};

// Statuses that, on their own, do NOT fail the whole crawl (auth / not-found).
const ACCEPTABLE_FAILURE_STATUSES = new Set([401, 403, 404, 410]);

// Hard wall on total crawl time — return whatever we have rather than hang.
// (Deliberate project decision; not part of the reference spec.)
const CRAWL_TIME_BUDGET_MS = 60_000;

export async function crawl(
  originUrl: string,
  opts: CrawlOptions = {},
): Promise<CrawlResult> {
  const cfg = { ...DEFAULTS, ...opts };

  // Normalise the start URL up front so the homepage's visited key matches any
  // self-links discovered later.
  const startUrl = normalizeUrl(originUrl);
  const base = new URL(startUrl);
  const baseScheme = base.protocol.replace(":", "");
  const baseHost = base.hostname;

  // The "+1 quirk": the homepage is excluded from the generated llms.txt, so we
  // crawl one extra content page to still end up with `maxPages` usable pages.
  const internalMaxPages = cfg.maxPages + 1;

  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const failedPages: FailedPage[] = [];
  const deadline = Date.now() + CRAWL_TIME_BUDGET_MS;

  async function crawlPage(
    rawUrl: string,
    parentUrl: string | null,
    depth: number,
  ): Promise<void> {
    const url = normalizeUrl(rawUrl, baseScheme);
    const key = visitedKey(url);

    // ── critical section (synchronous) ──────────────────────────────────────
    if (depth > cfg.maxDepth) return;
    if (Date.now() > deadline) return;
    if (visited.has(key)) return;
    if (pages.length >= internalMaxPages) return;
    visited.add(key);
    // ── end critical section ────────────────────────────────────────────────

    let result;
    try {
      result = await fetchPage(url, {
        userAgent: cfg.userAgent,
        timeoutMs: cfg.requestTimeoutMs,
      });
    } catch (err) {
      const message = err instanceof SsrfError ? err.message : String(err);
      failedPages.push({ url, error: message });
      return;
    }

    const { status, body, finalUrl } = result;
    if (status < 200 || status > 299) {
      failedPages.push({ url, status });
      return;
    }

    const $ = cheerio.load(body);
    const meta = extractPageMeta($, finalUrl);
    const content = extractMainContent($);
    const javascriptRendered = isJavascriptRendered(body, $);

    // ── critical section ────────────────────────────────────────────────────
    if (pages.length >= internalMaxPages) return;
    pages.push({
      url,
      finalUrl,
      statusCode: status,
      depth,
      parentUrl,
      html: body,
      title: meta.title,
      description: meta.description,
      associatedUrls: meta.associatedUrls,
      content,
      javascriptRendered,
    });
    const linksToFollow =
      depth < cfg.maxDepth && pages.length < internalMaxPages
        ? collectFollowLinks($, finalUrl, baseHost)
        : [];
    // ── end critical section ────────────────────────────────────────────────

    // Crawl children in parallel batches of CONCURRENCY.
    for (const batch of chunk(linksToFollow, cfg.concurrency)) {
      await Promise.all(batch.map((link) => crawlPage(link, url, depth + 1)));
    }
  }

  // Homepage is crawled first → it is always pages[0] (downstream relies on this).
  await crawlPage(startUrl, null, 0);

  const error =
    failedPages.length > 0 && !allAuthErrors(failedPages)
      ? `Crawl failed: ${failedPages
          .map((f) => (f.status != null ? `${f.url} (${f.status})` : `${f.url} (${f.error})`))
          .join("; ")}`
      : null;

  return {
    pages,
    failedPages,
    error,
    // Legacy stat fields for the existing Inngest pipeline.
    pagesFound: visited.size,
    pagesCrawled: pages.length,
    pagesSkipped: failedPages.length,
    sitemapUsed: false,
    errors: failedPages.map((f) => ({
      url: f.url,
      reason: f.status != null ? `HTTP ${f.status}` : (f.error ?? "unknown"),
    })),
  };
}

/**
 * True iff EVERY failed page is "acceptable": an auth/not-found status
 * (401/403/404/410) or an error message that looks like an auth failure. Such
 * failures alone do not fail the whole crawl. HOW_TO_CRAWL.md §4 `allAuthErrors?`.
 */
export function allAuthErrors(failed: FailedPage[]): boolean {
  if (failed.length === 0) return true;
  return failed.every((f) => {
    if (f.status != null) return ACCEPTABLE_FAILURE_STATUSES.has(f.status);
    return /auth|unauthorized|forbidden/i.test(f.error ?? "");
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Re-export same-domain checks for callers/tests that need them.
export { sameDomain };
