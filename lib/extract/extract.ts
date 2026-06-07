import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
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
    const { document } = parseHTML(html);
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    mainText = article?.textContent?.replace(/\s+/g, " ").trim() || null;
  } catch {
    // Readability can throw on malformed HTML — fall back to null.
  }

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();

  // Signal 1: thin body text
  const isThinBody = bodyText.length < 200;

  // Signal 2: known SPA framework globals / data attributes
  const isNextJs =
    $("script#__NEXT_DATA__").length > 0 || $("[data-reactroot]").length > 0;
  const isNuxt = html.includes("__NUXT__") || $("div#__nuxt").length > 0;
  const isAngular =
    $("[ng-version]").length > 0 || $("[ng-app]").length > 0;

  // Signal 3: generator meta tag (Next.js, Nuxt, Gatsby, CRA)
  const generatorMeta = $('meta[name="generator"]').attr("content") ?? "";
  const isSpaGenerator =
    /next\.js|nuxt|gatsby|create-react-app/i.test(generatorMeta);

  // Signal 4: SPA mount div present but nearly empty
  const mountText = (
    $("div#root").text() ||
    $("div#app").text() ||
    $("div#__next").text()
  )
    .replace(/\s+/g, " ")
    .trim();
  const isEmptyMount =
    $("div#root, div#app, div#__next").length > 0 && mountText.length < 200;

  const isJsShell =
    isThinBody || isNextJs || isNuxt || isAngular || isSpaGenerator || isEmptyMount;

  // Only hash substantive content. Thin text (< 300 chars) is often shared
  // navigation/shell boilerplate on JS-heavy sites, which would cause cache
  // collisions where all pages receive the first page's cached description.
  const contentHash =
    mainText && mainText.length >= 300
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
