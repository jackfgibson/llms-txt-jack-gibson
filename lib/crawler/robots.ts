import robotsParser from "robots-parser";
import { safeFetch } from "@/lib/url/ssrf";

const UA = "llms-txt-bot/1.0";

export interface RobotsInfo {
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
  sitemapUrls: string[];
}

export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const robotsUrl = `${origin}/robots.txt`;
  let txt = "";
  try {
    const res = await safeFetch(robotsUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) txt = await res.text();
  } catch {
    // Treat unreachable robots.txt as fully allowed.
  }

  const parser = robotsParser(robotsUrl, txt);

  const sitemapUrls: string[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^Sitemap:\s*(.+)$/i);
    if (m) sitemapUrls.push(m[1].trim());
  }

  const rawDelay = parser.getCrawlDelay(UA) ?? parser.getCrawlDelay("*") ?? 0;
  const crawlDelayMs = Math.min(rawDelay * 1000, 2_000);

  return {
    isAllowed(url: string) {
      return parser.isAllowed(url, UA) !== false;
    },
    crawlDelayMs,
    sitemapUrls,
  };
}
