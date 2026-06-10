import * as cheerio from "cheerio";
import { SsrfError } from "@/lib/url/ssrf";
import { fetchPage } from "./fetcher";
import { normalizeUrl, visitedKey, sameDomain } from "./normalize";
import { collectFollowLinks } from "./parse";
import type {
  CrawlOptions,
  CrawledPage,
  CrawlResult,
  FailedPage,
} from "./types";

// HOW_TO_CRAWL.md §4 — a depth-bounded, page-bounded, same-domain crawl.
//
// Strict level-order BFS. Within a level we fetch in parallel batches (for
// speed) but COMMIT results in deterministic discovery order — never in
// fetch-completion order. This makes the committed page SET timing-independent:
// two runs of the same site select the same pages regardless of network jitter,
// which is what keeps crawl-to-crawl diffs stable.

const DEFAULTS: Required<CrawlOptions> = {
  maxPages: 20, // DEFAULT_MAX_PAGES
  maxDepth: 3, // DEFAULT_MAX_DEPTH
  concurrency: 4, // CONCURRENCY — fetches per batch
  userAgent: "llms-txt-fetcher/0.1",
  requestTimeoutMs: 10_000,
};

// Statuses that, on their own, do NOT fail the whole crawl (auth / not-found).
const ACCEPTABLE_FAILURE_STATUSES = new Set([401, 403, 404, 410]);

// Hard wall on total crawl time — return whatever we have rather than hang.
// (Deliberate project decision; not part of the reference spec.)
const CRAWL_TIME_BUDGET_MS = 60_000;

interface FrontierItem {
  /** Normalised request URL (query + fragment stripped). */
  url: string;
  parentUrl: string | null;
  depth: number;
}

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
  // A single signal shared by all in-flight fetches. When the budget expires it
  // fires and aborts every pending fetchPage call immediately.
  const crawlSignal = AbortSignal.timeout(CRAWL_TIME_BUDGET_MS);

  // Homepage seeds depth 0 → it is always committed first → pages[0]
  // (downstream relies on this).
  const seedUrl = normalizeUrl(startUrl, baseScheme);
  visited.add(visitedKey(seedUrl));
  let frontier: FrontierItem[] = [{ url: seedUrl, parentUrl: null, depth: 0 }];

  while (
    frontier.length > 0 &&
    pages.length < internalMaxPages &&
    !crawlSignal.aborted
  ) {
    const nextFrontier: FrontierItem[] = [];

    for (const batch of chunk(frontier, cfg.concurrency)) {
      if (pages.length >= internalMaxPages || crawlSignal.aborted) break;

      // Fetch the batch in parallel. Promise.all preserves array (discovery)
      // order in its result, regardless of which fetch finishes first.
      const results = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await fetchPage(item.url, {
              userAgent: cfg.userAgent,
              timeoutMs: cfg.requestTimeoutMs,
              crawlSignal,
            });
            return { item, res, error: null };
          } catch (err) {
            const message = err instanceof SsrfError ? err.message : String(err);
            return { item, res: null, error: message };
          }
        }),
      );

      // Commit in deterministic discovery order — NOT completion order.
      let capReached = false;
      for (const r of results) {
        if (r.res === null) {
          failedPages.push({ url: r.item.url, error: r.error });
          continue;
        }
        const { status, body, finalUrl } = r.res;
        if (status < 200 || status > 299) {
          failedPages.push({ url: r.item.url, status });
          continue;
        }
        if (pages.length >= internalMaxPages) {
          capReached = true;
          break;
        }

        pages.push({
          url: r.item.url,
          finalUrl,
          statusCode: status,
          depth: r.item.depth,
          parentUrl: r.item.parentUrl,
          html: body,
        });

        // Discover children in deterministic DOM order; enqueue unvisited
        // same-domain links for the next level. Marking visited at enqueue time
        // keeps a child claimed by the first (discovery-ordered) page that links
        // it, so dedup is timing-independent too.
        if (r.item.depth < cfg.maxDepth) {
          const $ = cheerio.load(body);
          for (const link of collectFollowLinks($, finalUrl, baseHost)) {
            const childUrl = normalizeUrl(link, baseScheme);
            const key = visitedKey(childUrl);
            if (!visited.has(key)) {
              visited.add(key);
              nextFrontier.push({
                url: childUrl,
                parentUrl: r.item.url,
                depth: r.item.depth + 1,
              });
            }
          }
        }
      }

      if (capReached) break;
    }

    frontier = nextFrontier;
  }

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
