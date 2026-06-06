import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { createHash } from "crypto";

export interface ExtractedPage {
  url: string;
  title: string | null;
  metaDescription: string | null;
  og: Record<string, string>;
  canonical: string | null;
  lang: string | null;
  h1: string | null;
  mainText: string | null;
  contentHash: string | null;
  isJsShell: boolean;
}

export function extractPage(html: string, url: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || null;
  const canonical = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const lang = $("html").attr("lang")?.trim() || null;
  const h1 = $("h1").first().text().trim() || null;

  const og: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const prop = $(el).attr("property");
    const content = $(el).attr("content");
    if (prop && content) og[prop.replace("og:", "")] = content;
  });

  let mainText: string | null = null;
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    mainText = article?.textContent?.replace(/\s+/g, " ").trim() || null;
  } catch {
    // Readability can throw on malformed HTML — fall back to null.
  }

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const isJsShell = bodyText.length < 100;

  const contentHash = mainText
    ? createHash("sha256").update(mainText).digest("hex")
    : null;

  return {
    url,
    title,
    metaDescription,
    og,
    canonical,
    lang,
    h1,
    mainText,
    contentHash,
    isJsShell,
  };
}
