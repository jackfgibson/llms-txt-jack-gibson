import { XMLParser } from "fast-xml-parser";
import { safeFetch, SsrfError } from "@/lib/url/ssrf";

function sameEffectiveOrigin(url: string, origin: string): boolean {
  try {
    const u = new URL(url);
    const o = new URL(origin);
    if (u.protocol !== o.protocol) return false;
    const uh = u.hostname;
    const oh = o.hostname;
    return uh === oh || uh === `www.${oh}` || `www.${uh}` === oh;
  } catch {
    return false;
  }
}

const parser = new XMLParser({ ignoreAttributes: false });

export async function fetchSitemapUrls(
  sitemapUrl: string,
  origin: string,
  visited = new Set<string>(),
): Promise<string[]> {
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  let xml = "";
  try {
    const res = await safeFetch(sitemapUrl, {
      headers: { Accept: "application/xml,text/xml,*/*" },
    });
    if (!res.ok) return [];
    xml = await res.text();
  } catch (err) {
    if (err instanceof SsrfError) throw err;
    return [];
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }

  const urls: string[] = [];

  const index = parsed["sitemapindex"] as Record<string, unknown> | undefined;
  if (index) {
    const sitemaps = normaliseList(index["sitemap"]);
    for (const s of sitemaps) {
      const loc = (s as Record<string, unknown>)["loc"];
      if (typeof loc === "string" && sameEffectiveOrigin(loc, origin)) {
        urls.push(...(await fetchSitemapUrls(loc, origin, visited)));
      }
    }
    return urls;
  }

  const urlset = parsed["urlset"] as Record<string, unknown> | undefined;
  if (urlset) {
    const items = normaliseList(urlset["url"]);
    for (const item of items) {
      const loc = (item as Record<string, unknown>)["loc"];
      if (typeof loc === "string" && sameEffectiveOrigin(loc, origin)) {
        urls.push(loc);
      }
    }
  }

  return urls;
}

function normaliseList(v: unknown): unknown[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}
