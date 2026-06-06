export interface CrawlOptions {
  maxPages?: number;      // soft limit shown in UI (default 30)
  hardCeiling?: number;   // absolute hard stop (default 150)
  maxDepth?: number;      // BFS depth limit (default 3)
  concurrency?: number;   // parallel fetches (default 6)
  requestTimeoutMs?: number; // per-request timeout (default 10_000)
  politeDelayMs?: number; // min ms between requests to same host (default 500)
  userAgent?: string;
}

export interface CrawledPage {
  url: string;
  depth: number;
  statusCode: number;
  /** Raw HTML of the page. Empty string if fetch failed or non-HTML. */
  html: string;
  /** Resolved canonical URL if the server sent a redirect chain. */
  finalUrl: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  pagesFound: number;    // URLs discovered (including uncrawled)
  pagesCrawled: number;  // pages successfully fetched
  pagesSkipped: number;  // blocked by robots / depth / ceiling / non-HTML
  sitemapUsed: boolean;
  errors: Array<{ url: string; reason: string }>;
}
