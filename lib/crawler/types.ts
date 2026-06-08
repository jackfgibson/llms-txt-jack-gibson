// Crawler types — modelled on HOW_TO_CRAWL.md §4. The crawl produces a homepage-
// first list of pages (pages[0] is always the homepage) plus a list of failed
// pages. A crawl only "fails" when there are failures that are NOT all
// auth/not-found (see allAuthErrors in crawl.ts).

export interface CrawlOptions {
  /** User-facing page budget. The crawler internally uses maxPages + 1 so that
   *  after curation drops/merges the odd page we still tend to land near the
   *  requested count. */
  maxPages?: number;
  maxDepth?: number;
  /** Parallel fetches per batch of follow-links. Spec default: 4. */
  concurrency?: number;
  userAgent?: string;
  requestTimeoutMs?: number;
}

/** A failed page is either a bad HTTP status or a thrown error — never both. */
export interface FailedPage {
  url: string;
  status?: number;
  error?: string;
}

export interface CrawledPage {
  /** Normalised request URL (query + fragment stripped). */
  url: string;
  /** URL after following redirects — links resolve against this. */
  finalUrl: string;
  statusCode: number;
  depth: number;
  parentUrl: string | null;
  /** Raw HTML body — the extraction stage (extractPage) parses this for the
   *  fields the pipeline needs (title/og/canonical/contentHash/Readability).
   *  The crawl itself only parses for link discovery. */
  html: string;
}

export interface CrawlResult {
  /** Homepage-first list of successfully crawled pages. */
  pages: CrawledPage[];
  failedPages: FailedPage[];
  /** Non-null only when failures exist and are NOT all auth/not-found. */
  error: string | null;

  // ── Legacy stat fields the existing Inngest pipeline reads ──────────────────
  pagesFound: number;
  pagesCrawled: number;
  pagesSkipped: number;
  errors: Array<{ url: string; reason: string }>;
}
