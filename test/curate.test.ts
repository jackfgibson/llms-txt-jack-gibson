import { describe, it, expect } from "vitest";
import { classifyPage } from "@/lib/curate/classify";
import { scorePage } from "@/lib/curate/score";
import { curate } from "@/lib/curate/curate";
import { generateFallback } from "@/lib/llmstxt/generate";
import type { ExtractedPage } from "@/lib/extract/extract";

// ── classifyPage ──────────────────────────────────────────────────────────────

describe("classifyPage — path rules", () => {
  it("classifies depth-0 as home regardless of path", () => {
    expect(classifyPage({ url: "https://example.com/", title: null, h1: null, metaDescription: null, depth: 0 })).toBe("home");
  });

  it("classifies /docs/* as docs", () => {
    expect(classifyPage({ url: "https://example.com/docs/getting-started", title: null, h1: null, metaDescription: null, depth: 1 })).toBe("docs");
  });

  it("classifies /api-reference as api", () => {
    expect(classifyPage({ url: "https://example.com/api-reference/v2", title: null, h1: null, metaDescription: null, depth: 1 })).toBe("api");
  });

  it("classifies /blog/* as blog", () => {
    expect(classifyPage({ url: "https://example.com/blog/hello-world", title: null, h1: null, metaDescription: null, depth: 2 })).toBe("blog");
  });

  it("classifies /pricing as pricing", () => {
    expect(classifyPage({ url: "https://example.com/pricing", title: null, h1: null, metaDescription: null, depth: 1 })).toBe("pricing");
  });

  it("classifies /privacy as legal", () => {
    expect(classifyPage({ url: "https://example.com/privacy", title: null, h1: null, metaDescription: null, depth: 1 })).toBe("legal");
  });

  it("falls back to text hints when path is ambiguous", () => {
    expect(classifyPage({
      url: "https://example.com/page",
      title: "Privacy Policy",
      h1: "Our Privacy Policy",
      metaDescription: null,
      depth: 1,
    })).toBe("legal");
  });

  it("returns other for an unclassifiable page", () => {
    expect(classifyPage({
      url: "https://example.com/contact",
      title: "Contact Us",
      h1: null,
      metaDescription: null,
      depth: 2,
    })).toBe("other");
  });
});

// ── scorePage ─────────────────────────────────────────────────────────────────

describe("scorePage", () => {
  const base = {
    depth: 1,
    inlinkCount: 0,
    isJsShell: false,
    hasTitle: true,
    hasDescription: true,
    hasMainText: true,
    mainTextLength: 800,
  };

  it("returns 0 for a JS shell", () => {
    expect(scorePage({ ...base, pageType: "docs", isJsShell: true })).toBe(0);
  });

  it("docs scores higher than legal", () => {
    const docs = scorePage({ ...base, pageType: "docs" });
    const legal = scorePage({ ...base, pageType: "legal" });
    expect(docs).toBeGreaterThan(legal);
  });

  it("shallow pages score higher than deep pages (same type)", () => {
    const shallow = scorePage({ ...base, pageType: "docs", depth: 1 });
    const deep = scorePage({ ...base, pageType: "docs", depth: 3 });
    expect(shallow).toBeGreaterThan(deep);
  });

  it("inlinks improve score", () => {
    const noLinks = scorePage({ ...base, pageType: "docs", inlinkCount: 0 });
    const manyLinks = scorePage({ ...base, pageType: "docs", inlinkCount: 5 });
    expect(manyLinks).toBeGreaterThan(noLinks);
  });

  it("score is never negative", () => {
    const s = scorePage({ ...base, pageType: "legal", depth: 3, isJsShell: false, hasMainText: false, mainTextLength: 0 });
    expect(s).toBeGreaterThanOrEqual(0);
  });
});

// ── curate ────────────────────────────────────────────────────────────────────

function makePage(overrides: Partial<ExtractedPage> & { depth: number }): ExtractedPage & { depth: number } {
  return {
    url: "https://example.com/",
    title: "Example",
    metaDescription: "A site.",
    og: {},
    canonical: null,
    lang: "en",
    h1: "Welcome",
    mainText: "Some content here.",
    contentHash: "abc123",
    isJsShell: false,
    ...overrides,
  };
}

describe("curate", () => {
  it("returns sections grouped by page type", () => {
    const pages = [
      makePage({ depth: 0, url: "https://example.com/" }),
      makePage({ depth: 1, url: "https://example.com/docs/start", title: "Getting Started" }),
      makePage({ depth: 1, url: "https://example.com/pricing", title: "Pricing" }),
    ];
    const { sections } = curate(pages);
    const types = sections.map((s) => s.heading);
    expect(types).toContain("home");
    expect(types).toContain("docs");
    expect(types).toContain("pricing");
  });

  it("excludes JS shells", () => {
    const pages = [
      makePage({ depth: 0, url: "https://example.com/" }),
      makePage({ depth: 1, url: "https://example.com/shell", isJsShell: true }),
    ];
    const { sections } = curate(pages);
    const allUrls = sections.flatMap((s) => s.pages.map((p) => p.url));
    expect(allUrls).not.toContain("https://example.com/shell");
  });

  it("respects maxPages limit", () => {
    const pages = Array.from({ length: 20 }, (_, i) =>
      makePage({ depth: 1, url: `https://example.com/docs/${i}`, title: `Doc ${i}` }),
    );
    const { sections } = curate(pages, { maxPages: 5 });
    const total = sections.reduce((n, s) => n + s.pages.length, 0);
    expect(total).toBeLessThanOrEqual(5);
  });

  it("sections follow canonical order (home before docs before blog)", () => {
    const pages = [
      makePage({ depth: 2, url: "https://example.com/blog/post", title: "Post" }),
      makePage({ depth: 0, url: "https://example.com/" }),
      makePage({ depth: 1, url: "https://example.com/docs/ref", title: "Ref" }),
    ];
    const { sections } = curate(pages);
    const types = sections.map((s) => s.heading);
    expect(types.indexOf("home")).toBeLessThan(types.indexOf("docs"));
    expect(types.indexOf("docs")).toBeLessThan(types.indexOf("blog"));
  });
});

// ── generateFallback ──────────────────────────────────────────────────────────

describe("generateFallback", () => {
  it("produces spec-valid output for a simple set of pages", () => {
    const pages = [
      makePage({ depth: 0, url: "https://example.com/", title: "Acme", metaDescription: "We build things." }),
      makePage({ depth: 1, url: "https://example.com/docs/start", title: "Getting Started", metaDescription: "How to get started." }),
    ];
    const { sections } = curate(pages);
    const result = generateFallback("Acme", "We build things.", sections);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.score).toBeGreaterThanOrEqual(85);
    expect(result.mode).toBe("fallback");
    expect(result.content).toContain("# Acme");
    expect(result.content).toContain("## ");
  });

  it("uses metaDescription as the page description", () => {
    const pages = [makePage({ depth: 1, url: "https://example.com/docs/start", title: "Getting Started", metaDescription: "Start here!" })];
    const { sections } = curate(pages);
    const result = generateFallback("Acme", null, sections);
    expect(result.content).toContain("Start here!");
  });

  it("falls back to first sentence of mainText when no metaDescription", () => {
    const pages = [
      makePage({
        depth: 1,
        url: "https://example.com/docs/start",
        title: "Getting Started",
        metaDescription: null,
        mainText: "This is the first sentence. This is the second.",
      }),
    ];
    const { sections } = curate(pages);
    const result = generateFallback("Acme", null, sections);
    expect(result.content).toContain("This is the first sentence.");
  });

  it("output starts with exactly one H1", () => {
    const pages = [makePage({ depth: 0, url: "https://example.com/", title: "Acme" })];
    const { sections } = curate(pages);
    const result = generateFallback("Acme", null, sections);
    const h1s = result.content.split("\n").filter((l) => /^# /.test(l));
    expect(h1s).toHaveLength(1);
  });
});
