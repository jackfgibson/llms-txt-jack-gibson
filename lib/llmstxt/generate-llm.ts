import pLimit from "p-limit";
import { hasApiKey } from "@/lib/llm/client";
import { describePage } from "@/lib/llm/describe";
import { generateSiteSummary } from "@/lib/llm/summarize";
import { generateFallback, type GenerateResult } from "./generate";
import type { CuratedSection } from "@/lib/curate/curate";

/**
 * DB-agnostic cache interface. The Inngest step provides an adapter backed
 * by the page_descriptions table; tests can inject an in-memory stub.
 */
export interface DescriptionCache {
  get(contentHash: string): Promise<{ description: string; provenance: string } | null>;
  set(contentHash: string, description: string, provenance: string): Promise<void>;
}

/**
 * Generates an llms.txt file with LLM-grounded descriptions.
 *
 * If ANTHROPIC_API_KEY is unset this is a transparent wrapper around
 * generateFallback — the app works end-to-end without a key.
 *
 * When a key is available:
 *  1. Generates a cleaned site title + blockquote from home/about content.
 *  2. Checks the description cache for each page by content_hash.
 *  3. Calls Claude for uncached pages and writes results back to cache.
 *  4. Feeds enriched descriptions into generateFallback for serialization.
 */
export async function generateWithLlm(
  rawSiteTitle: string,
  rawSiteDescription: string | null,
  sections: CuratedSection[],
  cache: DescriptionCache,
): Promise<GenerateResult> {
  if (!hasApiKey()) {
    return generateFallback(rawSiteTitle, rawSiteDescription, sections);
  }

  const allPages = sections.flatMap((s) => s.pages);

  // ── Site summary ─────────────────────────────────────────────────────────
  const homePage = allPages.find((p) => p.pageType === "home");
  const aboutPage = allPages.find((p) => p.pageType === "about");

  const homeContent = [
    homePage?.title,
    homePage?.metaDescription,
    homePage?.mainText?.slice(0, 2000),
  ]
    .filter(Boolean)
    .join("\n\n");

  const aboutContent = [
    aboutPage?.metaDescription,
    aboutPage?.mainText?.slice(0, 1500),
  ]
    .filter(Boolean)
    .join("\n\n");

  let siteTitle = rawSiteTitle;
  let siteDescription = rawSiteDescription;

  if (homeContent) {
    const summary = await generateSiteSummary(
      rawSiteTitle,
      homeContent,
      aboutContent || null,
    );
    if (summary) {
      siteTitle = summary.siteTitle;
      siteDescription = summary.summary;
    }
  }

  // ── Seed description map from cache (one lookup per unique hash) ──────────
  const uniqueHashes = [
    ...new Set(
      allPages.map((p) => p.contentHash).filter(Boolean) as string[],
    ),
  ];

  const descMap = new Map<string, string>(); // key: contentHash or url

  await Promise.all(
    uniqueHashes.map(async (hash) => {
      const cached = await cache.get(hash);
      if (cached) descMap.set(hash, cached.description);
    }),
  );

  // ── LLM-fill uncached pages ───────────────────────────────────────────────
  const limit = pLimit(4);

  await Promise.all(
    allPages.map((page) =>
      limit(async () => {
        // Already have a description from cache
        if (page.contentHash && descMap.has(page.contentHash)) return;
        // Nothing to ground a description in
        if (!page.mainText && !page.metaDescription) return;

        const result = await describePage({
          url: page.url,
          title: page.title,
          metaDescription: page.metaDescription,
          mainText: page.mainText,
        });

        if (result) {
          if (page.contentHash) {
            descMap.set(page.contentHash, result.description);
            await cache.set(page.contentHash, result.description, result.provenance);
          } else {
            // Hash-less page (JS shell with only meta) — use URL as ephemeral key
            descMap.set(page.url, result.description);
          }
        }
      }),
    ),
  );

  // ── Enrich sections ───────────────────────────────────────────────────────
  const enrichedSections: CuratedSection[] = sections.map((section) => ({
    ...section,
    pages: section.pages.map((page) => ({
      ...page,
      description:
        (page.contentHash && descMap.get(page.contentHash)) ||
        descMap.get(page.url) ||
        page.description,
    })),
  }));

  const result = generateFallback(siteTitle, siteDescription, enrichedSections);

  return { ...result, mode: "llm" };
}
