import { classifyPage, type PageType } from "./classify";
import { scorePage } from "./score";
import type { ExtractedPage } from "@/lib/extract/extract";

export interface CuratedPage {
  url: string;
  title: string;
  pageType: PageType;
  score: number;
  inlinkCount: number;
  description: string | null; // filled in by generate step
  metaDescription: string | null;
  mainText: string | null;
  contentHash: string | null;
}

export interface CuratedSection {
  heading: PageType;
  pages: CuratedPage[];
}

// Section order in the final llms.txt
const SECTION_ORDER: PageType[] = [
  "home",
  "docs",
  "api",
  "product",
  "about",
  "blog",
  "pricing",
  "support",
  "legal",
  "other",
];

const SECTION_LABELS: Record<PageType, string> = {
  home: "Home",
  docs: "Documentation",
  api: "API Reference",
  product: "Product",
  about: "About",
  blog: "Blog",
  pricing: "Pricing",
  support: "Help & Support",
  legal: "Legal",
  other: "Other Pages",
};

export { SECTION_LABELS };

export interface CurateResult {
  sections: CuratedSection[];
  /** Raw page list with scores applied — used to persist score+type back to DB */
  scored: Array<ExtractedPage & { pageType: PageType; score: number; inlinkCount: number; depth: number }>;
}

export function curate(
  pages: Array<ExtractedPage & { depth: number }>,
  opts: { maxPages?: number } = {},
): CurateResult {
  const maxPages = opts.maxPages ?? 50;

  // ── 1. Count inlinks ──────────────────────────────────────────────────────
  // We don't have the link graph at this point, but we can approximate by
  // counting how many times each URL appears as a canonical across the set.
  // A richer inlink count is built during the BFS crawl; here we default to 0.
  const inlinkCounts = new Map<string, number>();
  for (const p of pages) {
    inlinkCounts.set(p.url, inlinkCounts.get(p.url) ?? 0);
    if (p.canonical && p.canonical !== p.url) {
      inlinkCounts.set(
        p.canonical,
        (inlinkCounts.get(p.canonical) ?? 0) + 1,
      );
    }
  }

  // ── 2. Classify + score ───────────────────────────────────────────────────
  const scored = pages.map((p) => {
    const pageType = classifyPage({
      url: p.url,
      title: p.title,
      h1: p.h1,
      metaDescription: p.metaDescription,
      depth: p.depth,
    });
    const inlinkCount = inlinkCounts.get(p.url) ?? 0;
    const score = scorePage({
      pageType,
      depth: p.depth,
      inlinkCount,
      isJsShell: p.isJsShell,
      hasTitle: Boolean(p.title),
      hasDescription: Boolean(p.metaDescription),
      hasMainText: Boolean(p.mainText),
      mainTextLength: p.mainText?.length ?? 0,
    });
    return { ...p, pageType, score, inlinkCount };
  });

  // ── 3. Select top N by score ──────────────────────────────────────────────
  const selected = scored
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages);

  // ── 4. Group into sections ────────────────────────────────────────────────
  const byType = new Map<PageType, CuratedPage[]>();
  for (const p of selected) {
    if (!byType.has(p.pageType)) byType.set(p.pageType, []);
    byType.get(p.pageType)!.push({
      url: p.url,
      title: p.title ?? p.h1 ?? p.url,
      pageType: p.pageType,
      score: p.score,
      inlinkCount: p.inlinkCount,
      description: null,
      metaDescription: p.metaDescription,
      mainText: p.mainText,
      contentHash: p.contentHash,
    });
  }

  // Sort pages within each section by score desc
  for (const pages of byType.values()) {
    pages.sort((a, b) => b.score - a.score);
  }

  const sections: CuratedSection[] = SECTION_ORDER.filter((t) =>
    byType.has(t),
  ).map((t) => ({ heading: t, pages: byType.get(t)! }));

  return { sections, scored };
}
