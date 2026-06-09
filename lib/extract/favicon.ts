import * as cheerio from "cheerio";

export function extractFaviconUrl(html: string, baseUrl: string): string {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;

  const selectors = [
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="apple-touch-icon-precomposed"]',
  ];

  for (const sel of selectors) {
    const href = $(sel).first().attr("href");
    if (href) {
      try {
        return new URL(href, origin).href;
      } catch {
        // ignore malformed href
      }
    }
  }

  return `${origin}/favicon.ico`;
}
