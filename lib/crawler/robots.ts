import robotsParser from "robots-parser";
import { safeFetch } from "@/lib/url/ssrf";

const UA = "llms-txt-bot/1.0";

export interface RobotsInfo {
  /** Whether the given path is allowed for our user-agent */
  isAllowed(url: string): boolean;
  /** Crawl-delay in ms (0 if not set) */
  crawlDelayMs: number;
  /** Sitemap URLs declared in robots.txt */
  sitemapUrls: string[];
}

export async function fetchRobots(origin: string): Promise<RobotsInfo> {
  const robotsUrl = `${origin}/robots.txt`;
  let txt = "";
  try {
    const res = await safeFetch(robotsUrl, {
      headers: { "User-Agent": UA },
    });
    if (res.ok) txt = await res.text();
  } catch {
    // If robots.txt is unreachable, treat everything as allowed.
  }

  const parser = robotsParser(robotsUrl, txt);

  const sitemapUrls: string[] = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^Sitemap:\s*(.+)$/i);
    if (m) sitemapUrls.push(m[1].trim());
  }

  const rawDelay = parser.getCrawlDelay(UA) ?? parser.getCrawlDelay("*") ?? 0;
  // Cap crawl-delay at 5 s so a malicious site can't stall us forever.
  const crawlDelayMs = Math.min(rawDelay * 1000, 5_000);

  return {
    isAllowed(url: string) {
      return parser.isAllowed(url, UA) !== false;
    },
    crawlDelayMs,
    sitemapUrls,
  };
}
