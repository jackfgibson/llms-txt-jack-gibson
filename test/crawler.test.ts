import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";
import {
  normalizeUrl,
  normalizeHost,
  normalizePath,
  visitedKey,
  sameDomain,
} from "@/lib/crawler/normalize";
import {
  extractMainContent,
  collectFollowLinks,
  isJavascriptRendered,
  extractPageMeta,
} from "@/lib/crawler/parse";
import { allAuthErrors, crawl } from "@/lib/crawler/crawl";

// Per-test HTTP status overrides for the mocked fetcher, hoisted so the
// vi.mock factory below can read them.
const fetchCfg = vi.hoisted(() => ({ statusOverrides: {} as Record<string, number> }));

// Mock the fetcher with a fixed in-memory site graph. Crucially, each fetch
// resolves after a RANDOM delay so completion order is shuffled every run —
// proving the crawler commits in deterministic discovery order, not by timing.
vi.mock("@/lib/crawler/fetcher", () => {
  const childLinks = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const homepage = `<html><body>${childLinks
    .map((s) => `<a href="/${s}">${s}</a>`)
    .join("")}</body></html>`;
  return {
    fetchPage: async (url: string) => {
      await new Promise((r) => setTimeout(r, Math.random() * 15));
      const path = new URL(url).pathname;
      const status = fetchCfg.statusOverrides[path] ?? 200;
      const body =
        path === "/"
          ? homepage
          : `<html><body><p>content for ${path} ${"lorem ".repeat(40)}</p></body></html>`;
      return { body, status, finalUrl: url };
    },
    clearBodyCache: () => {},
  };
});

afterEach(() => {
  fetchCfg.statusOverrides = {};
});

// ── URL normalisation (HOW_TO_CRAWL.md §4) ───────────────────────────────────

describe("normalizeUrl", () => {
  it("prepends the base scheme when missing", () => {
    expect(normalizeUrl("example.com/x", "https")).toBe("https://example.com/x");
    expect(normalizeUrl("example.com", "http")).toBe("http://example.com/");
  });

  it("strips query string and fragment", () => {
    expect(normalizeUrl("https://example.com/p?a=1#frag")).toBe(
      "https://example.com/p",
    );
  });

  it("treats /p?a=1 and /p?a=2 as the same URL", () => {
    expect(normalizeUrl("https://example.com/p?a=1")).toBe(
      normalizeUrl("https://example.com/p?a=2"),
    );
  });

  it("returns the raw string on parse error", () => {
    expect(normalizeUrl("http://[bad")).toBe("http://[bad");
  });
});

describe("normalizeHost", () => {
  it("strips a leading www.", () => {
    expect(normalizeHost("www.figma.com")).toBe("figma.com");
    expect(normalizeHost("figma.com")).toBe("figma.com");
  });
});

describe("normalizePath", () => {
  it("maps empty and / to /", () => {
    expect(normalizePath("")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("strips a single trailing slash", () => {
    expect(normalizePath("/about/")).toBe("/about");
    expect(normalizePath("/docs/guides")).toBe("/docs/guides");
  });
});

describe("visitedKey", () => {
  it("is scheme / www / trailing-slash agnostic", () => {
    const a = visitedKey("https://www.figma.com/about/");
    const b = visitedKey("http://figma.com/about");
    expect(a).toBe(b);
    expect(a).toBe("figma.com/about");
  });

  it("collapses query-string variants of the same path", () => {
    expect(visitedKey("https://x.com/p?a=1")).toBe(visitedKey("https://x.com/p?a=2"));
  });
});

describe("sameDomain", () => {
  it("matches www and non-www of the base host", () => {
    expect(sameDomain("https://www.figma.com/x", "figma.com")).toBe(true);
    expect(sameDomain("https://figma.com/x", "www.figma.com")).toBe(true);
  });

  it("rejects other domains and non-http(s) schemes", () => {
    expect(sameDomain("https://other.com/x", "figma.com")).toBe(false);
    expect(sameDomain("mailto:hi@figma.com", "figma.com")).toBe(false);
    expect(sameDomain("ftp://figma.com/x", "figma.com")).toBe(false);
  });
});

// ── Link collection (§4 collectFollowLinks) ──────────────────────────────────

describe("collectFollowLinks", () => {
  it("keeps same-domain links, resolves relatives, drops junk + cross-domain", () => {
    const html = `
      <a href="/about">About</a>
      <a href="about">Rel</a>
      <a href="#section">Anchor</a>
      <a href="javascript:void(0)">JS</a>
      <a href="mailto:hi@x.com">Mail</a>
      <a href="https://other.com/x">External</a>
      <a href="https://www.example.com/team">WWW same-site</a>
    `;
    const $ = cheerio.load(html);
    const links = collectFollowLinks($, "https://example.com/", "example.com");
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://www.example.com/team");
    expect(links.some((l) => l.includes("other.com"))).toBe(false);
    expect(links.some((l) => l.startsWith("javascript:"))).toBe(false);
    expect(links.some((l) => l.startsWith("mailto:"))).toBe(false);
    expect(links.some((l) => l.includes("#"))).toBe(false);
  });

  it("dedupes repeated links", () => {
    const $ = cheerio.load(`<a href="/x">1</a><a href="/x">2</a>`);
    const links = collectFollowLinks($, "https://example.com/", "example.com");
    expect(links).toEqual(["https://example.com/x"]);
  });
});

// ── §5.3 PageExtractor ────────────────────────────────────────────────────────

describe("extractPageMeta", () => {
  it("prefers <title> then og:title", () => {
    const $ = cheerio.load(`<title>Real Title</title><meta property="og:title" content="OG">`);
    expect(extractPageMeta($, "https://x.com").title).toBe("Real Title");
  });

  it("falls back to og:title when <title> is empty", () => {
    const $ = cheerio.load(`<title>  </title><meta property="og:title" content="OG Title">`);
    expect(extractPageMeta($, "https://x.com").title).toBe("OG Title");
  });

  it("prefers meta description then og:description", () => {
    const $ = cheerio.load(`<meta name="description" content="Meta desc">`);
    expect(extractPageMeta($, "https://x.com").description).toBe("Meta desc");
  });
});

// ── §4.4 extractMainContent ──────────────────────────────────────────────────

describe("extractMainContent", () => {
  it("uses <main> when present", () => {
    const $ = cheerio.load(`<body><nav>menu</nav><main>  Hello   world  </main></body>`);
    expect(extractMainContent($)).toBe("Hello world");
  });

  it("falls back to body minus chrome", () => {
    const $ = cheerio.load(
      `<body><header>h</header><nav>n</nav><p>Core text</p><footer>f</footer><script>x()</script></body>`,
    );
    const text = extractMainContent($);
    expect(text).toBe("Core text");
  });
});

// ── §5.2 isJavascriptRendered ────────────────────────────────────────────────

describe("isJavascriptRendered", () => {
  it("flags near-empty body text", () => {
    const html = `<html><body><div id="root"></div></body></html>`;
    expect(isJavascriptRendered(html, cheerio.load(html))).toBe(true);
  });

  it("flags Next.js data marker", () => {
    const filler = "word ".repeat(100);
    const html = `<html><body><p>${filler}</p><script id="__NEXT_DATA__">{}</script></body></html>`;
    expect(isJavascriptRendered(html, cheerio.load(html))).toBe(true);
  });

  it("flags a JS generator meta tag", () => {
    const filler = "word ".repeat(100);
    const html = `<html><head><meta name="generator" content="Gatsby 5.0"></head><body><p>${filler}</p></body></html>`;
    expect(isJavascriptRendered(html, cheerio.load(html))).toBe(true);
  });

  it("does not flag a content-rich static page", () => {
    const filler = "word ".repeat(200);
    const html = `<html><body><article>${filler}</article></body></html>`;
    expect(isJavascriptRendered(html, cheerio.load(html))).toBe(false);
  });
});

// ── §4 allAuthErrors — crawl failure leniency ────────────────────────────────

describe("allAuthErrors", () => {
  it("is true for an empty list", () => {
    expect(allAuthErrors([])).toBe(true);
  });

  it("is true when every failure is auth/not-found", () => {
    expect(
      allAuthErrors([
        { url: "a", status: 403 },
        { url: "b", status: 404 },
        { url: "c", error: "Unauthorized access" },
      ]),
    ).toBe(true);
  });

  it("is false when any failure is a real error", () => {
    expect(
      allAuthErrors([
        { url: "a", status: 404 },
        { url: "b", status: 500 },
      ]),
    ).toBe(false);
    expect(allAuthErrors([{ url: "c", error: "connection reset" }])).toBe(false);
  });
});

// ── Deterministic page selection (cause #2 of crawl inconsistency) ────────────

describe("crawl determinism", () => {
  it("selects the same page set across runs despite randomised fetch timing", async () => {
    const run1 = await crawl("https://t.com/", { maxPages: 3 });
    const run2 = await crawl("https://t.com/", { maxPages: 3 });

    const expected = [
      "https://t.com/",
      "https://t.com/a",
      "https://t.com/b",
      "https://t.com/c",
    ];
    // maxPages 3 → internal budget 4 (homepage + first 3 children in DOM order).
    expect(run1.pages.map((p) => p.url)).toEqual(expected);
    expect(run2.pages.map((p) => p.url)).toEqual(expected);
  });

  it("keeps the homepage as pages[0] at depth 0", async () => {
    const res = await crawl("https://t.com/", { maxPages: 3 });
    expect(res.pages[0].url).toBe("https://t.com/");
    expect(res.pages[0].depth).toBe(0);
  });

  it("respects the page cap (maxPages + 1 internal budget)", async () => {
    const res = await crawl("https://t.com/", { maxPages: 3 });
    expect(res.pages.length).toBeLessThanOrEqual(4);
  });

  it("a 404 in the middle does not reduce the committed count below the cap", async () => {
    fetchCfg.statusOverrides["/a"] = 404;
    const res = await crawl("https://t.com/", { maxPages: 3 });

    // /a is skipped; the next discovery-ordered successes fill the budget.
    expect(res.pages.map((p) => p.url)).toEqual([
      "https://t.com/",
      "https://t.com/b",
      "https://t.com/c",
      "https://t.com/d",
    ]);
    expect(
      res.failedPages.some((f) => f.url === "https://t.com/a" && f.status === 404),
    ).toBe(true);
    // 404 alone does not fail the crawl.
    expect(res.error).toBeNull();
  });
});
