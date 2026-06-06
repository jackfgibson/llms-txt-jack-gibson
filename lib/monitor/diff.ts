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
 * Compares two crawl snapshots by URL + content_hash.
 * Pure function — no DB calls.
 */
export function diffCrawls(
  prev: PageSnapshot[],
  next: PageSnapshot[],
): CrawlDiffResult {
  const prevMap = new Map(prev.map((p) => [p.url, p.contentHash]));
  const nextMap = new Map(next.map((p) => [p.url, p.contentHash]));

  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];

  for (const [url, hash] of nextMap) {
    if (!prevMap.has(url)) {
      added.push(url);
    } else if (prevMap.get(url) !== hash) {
      changed.push(url);
    } else {
      unchanged.push(url);
    }
  }

  for (const url of prevMap.keys()) {
    if (!nextMap.has(url)) {
      removed.push(url);
    }
  }

  return { added, removed, changed, unchanged };
}

/** Returns true when the diff has at least one meaningful change worth regenerating. */
export function isMeaningfulChange(diff: CrawlDiffResult): boolean {
  return diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;
}
