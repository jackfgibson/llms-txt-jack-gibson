import * as cheerio from "cheerio";
import { sameDomain } from "./normalize";

type Dom = cheerio.CheerioAPI;

/** Collapse all whitespace runs to single spaces and trim. */
function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// ── §5.3 PageExtractor: title / description / associated_urls ─────────────────

export interface PageMeta {
  title: string | null;
  description: string | null;
  associatedUrls: string[];
}

export function extractPageMeta($: Dom, baseUrl: string): PageMeta {
  const title =
    $("title").first().text().trim() ||
    $('meta[property="og:title"]').attr("content")?.trim() ||
    null;

  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    null;

  // All <a href> resolved to absolute, excluding #/javascript:/mailto:, deduped.
  // NOT same-domain filtered (captured for context only).
  const associatedUrls = collectLinks($, baseUrl, null);

  return { title, description, associatedUrls };
}

// ── §4 collectFollowLinks: same-domain links to recurse into ─────────────────

/**
 * Shared link collector. When `baseHost` is non-null, only same-domain links
 * are kept (collectFollowLinks); when null, all links are kept (associated_urls).
 */
function collectLinks($: Dom, currentUrl: string, baseHost: string | null): string[] {
  const out = new Set<string>();
  $("a[href]").each((_, el) => {
    const raw = $(el).attr("href");
    if (!raw) return;
    const href = raw.trim();
    if (
      !href ||
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:")
    ) {
      return;
    }
    let abs: string;
    try {
      abs = new URL(href, currentUrl).toString();
    } catch {
      return;
    }
    if (baseHost !== null && !sameDomain(abs, baseHost)) return;
    out.add(abs);
  });
  return [...out];
}

export function collectFollowLinks($: Dom, currentUrl: string, baseHost: string): string[] {
  return collectLinks($, currentUrl, baseHost);
}

// ── §4.4 extractMainContent ──────────────────────────────────────────────────

/**
 * 1. Try the first of `main, article, [role="main"]` → cleaned text.
 * 2. Else `<body>` minus `script/style/nav/footer/header` → cleaned text.
 */
export function extractMainContent($: Dom): string {
  const main = $("main, article, [role='main']").first();
  if (main.length) return cleanText(main.text());

  const body = $("body").clone();
  body.find("script, style, nav, footer, header").remove();
  return cleanText(body.text());
}

// ── §5.2 isJavascriptRendered ────────────────────────────────────────────────

const JS_MARKERS = [
  "__NEXT_DATA__",
  "__NUXT__",
  "__NUXT_DATA__",
  "data-reactroot",
  "data-react-root",
  "ng-version",
  "ng-app",
  "litNonce",
  "lit.dev",
];

const JS_GENERATORS = ["next.js", "nuxt", "gatsby"];

/**
 * Heuristic: returns true when the page likely needs JS to render its content
 * (so the static HTML we fetched may be incomplete). Informational only — we do
 * NOT render JS (see MASTER_PLAN non-goals). Any one signal flips it true.
 */
export function isJavascriptRendered(html: string, $: Dom): boolean {
  // 1. Near-empty body text.
  if (cleanText($("body").text()).length < 300) return true;

  // 2. Known SPA framework markers in the raw HTML.
  if (JS_MARKERS.some((m) => html.includes(m))) return true;

  // 3. A root container exists but is nearly empty.
  const root = $("#root, #app, #__next, [data-reactroot]").first();
  if (root.length && cleanText(root.text()).length < 200) return true;

  // 4. Custom/web-component tags that imply client rendering.
  if (
    $(
      "shreddit-app-attrs, shreddit-async-loader, shreddit-page-meta, faceplate-tracker",
    ).length
  ) {
    return true;
  }

  // 5. <meta name="generator"> naming a JS framework.
  const gen = ($('meta[name="generator"]').attr("content") ?? "").toLowerCase();
  if (JS_GENERATORS.some((g) => gen.includes(g))) return true;

  return false;
}
