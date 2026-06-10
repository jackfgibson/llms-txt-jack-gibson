import { visitedKey } from "@/lib/crawler/normalize";

export interface PageSnapshot {
  url: string;
  contentHash: string | null;
}

export interface CrawlDiffResult {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

/**
 * Compares two crawl snapshots.
 *
 * Pages are matched on `visitedKey(url)` — the same scheme/www/trailing-slash/
 * query-string-agnostic identity the crawler already dedups on during a crawl
 * (`crawl.ts` keys `visited` by `visitedKey`). This means the same logical page
 * persisted under a slightly different post-redirect URL across runs (tracking
 * params, www vs apex, a trailing slash) is treated as the SAME page instead of
 * a spurious removed+added pair. The original `url` strings are reported back.
 *
 * Pure function — no DB calls.
 */
export function diffCrawls(
  prev: PageSnapshot[],
  next: PageSnapshot[],
): CrawlDiffResult {
  const prevMap = new Map(prev.map((p) => [visitedKey(p.url), p]));
  const nextMap = new Map(next.map((p) => [visitedKey(p.url), p]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [key, page] of nextMap) {
    const prevPage = prevMap.get(key);
    if (!prevPage) {
      added.push(page.url);
    } else if (prevPage.contentHash !== page.contentHash) {
      changed.push(page.url);
    } else {
      unchanged.push(page.url);
    }
  }

  for (const [key, page] of prevMap) {
    if (!nextMap.has(key)) removed.push(page.url);
  }

  return { added, removed, changed, unchanged };
}

/** Returns true when the diff has at least one meaningful change worth regenerating. */
export function isMeaningfulChange(diff: CrawlDiffResult): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
