import pLimit from "p-limit";
import { describePage } from "@/lib/llm/describe";
import { generateSiteSummary } from "@/lib/llm/summarize";
import { generateFallback, type GenerateResult } from "./generate";
import type { CuratedSection } from "@/lib/curate/curate";
import type { LlmProvider } from "@/lib/llm/call";

export interface DescriptionCache {
  get(contentHash: string): Promise<{ description: string; provenance: string } | null>;
  set(contentHash: string, description: string, provenance: string): Promise<void>;
}

/**
 * Generates an llms.txt file with LLM-grounded descriptions.
 *
 * `provider` must be "anthropic", "openai", or "gemini". If the corresponding
 * API key is missing, falls back to generateFallback automatically.
 *
 * Parallel calls from the pipeline each supply their own provider so
 * descriptions are generated independently per model.
 */
export async function generateWithLlm(
  rawSiteTitle: string,
  rawSiteDescription: string | null,
  sections: CuratedSection[],
  cache: DescriptionCache,
  provider: LlmProvider,
): Promise<GenerateResult> {
  // Guard: if the key for this provider isn't set, use fallback mode
  const keyPresent =
    provider === "anthropic"
      ? Boolean(process.env.ANTHROPIC_API_KEY?.trim())
      : provider === "openai"
        ? Boolean(process.env.OPENAI_API_KEY?.trim())
        : Boolean(process.env.GOOGLE_API_KEY?.trim());

  if (!keyPresent) {
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
      provider,
    );
    if (summary) {
      siteTitle = summary.siteTitle;
      siteDescription = summary.summary;
    }
  }

  // ── Seed description map from cache ───────────────────────────────────────
  const uniqueHashes = [
    ...new Set(
      allPages.map((p) => p.contentHash).filter(Boolean) as string[],
    ),
  ];

  const descMap = new Map<string, string>();

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
        if (page.contentHash && descMap.has(page.contentHash)) return;
        if (!page.mainText && !page.metaDescription) return;

        const result = await describePage(
          {
            url: page.url,
            title: page.title,
            metaDescription: page.metaDescription,
            // Suppress thin mainText — Readability sometimes returns shared
            // navigation boilerplate from JS-shell pages rather than article
            // content. The LLM should rely on meta + title in that case.
            mainText: page.mainText && page.mainText.length >= 300 ? page.mainText : null,
          },
          provider,
        );

        if (result) {
          if (page.contentHash) {
            descMap.set(page.contentHash, result.description);
            await cache.set(page.contentHash, result.description, result.provenance);
          } else {
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
