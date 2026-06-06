export interface CrawlOptions {
  maxPages?: number;
  hardCeiling?: number;
  maxDepth?: number;
  concurrency?: number;
  requestTimeoutMs?: number;
  politeDelayMs?: number;
  userAgent?: string;
}

export interface CrawledPage {
  url: string;
  depth: number;
  statusCode: number;
  html: string;
  finalUrl: string;
}

export interface CrawlResult {
  pages: CrawledPage[];
  pagesFound: number;
  pagesCrawled: number;
  pagesSkipped: number;
  sitemapUsed: boolean;
  errors: Array<{ url: string; reason: string }>;
}
