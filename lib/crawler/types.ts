// Crawler types — modelled on HOW_TO_CRAWL.md §4. The crawl produces a homepage-
// first list of pages (pages[0] is always the homepage) plus a list of failed
// pages. A crawl only "fails" when there are failures that are NOT all
// auth/not-found (see allAuthErrors in crawl.ts).

export interface CrawlOptions {
  /** User-facing page budget. The crawler internally uses maxPages + 1 (the "+1
   *  quirk") because the homepage is excluded from the generated llms.txt. */
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
  /** Raw HTML body — retained so the extraction stage can re-parse for the
   *  richer fields (og/canonical/contentHash/Readability) the pipeline needs. */
  html: string;

  // ── Fields extracted during the crawl (HOW_TO_CRAWL.md §4.4 / §5.2 / §5.3) ──
  title: string | null;
  description: string | null;
  associatedUrls: string[];
  /** Main text content (main/article/[role=main] → body minus chrome). */
  content: string;
  javascriptRendered: boolean;
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
  sitemapUsed: boolean;
  errors: Array<{ url: string; reason: string }>;
}
