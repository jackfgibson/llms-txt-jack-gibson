import { and, eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { crawlRequested, crawlCompleted } from "../events";
import { crawl } from "@/lib/crawler/crawl";
import { extractPage } from "@/lib/extract/extract";
import { curate } from "@/lib/curate/curate";
import { generateFallback } from "@/lib/llmstxt/generate";
import { db, schema } from "@/lib/db";

export const crawlSite = inngest.createFunction(
  {
    id: "crawl-site",
    triggers: [{ event: crawlRequested }],
    retries: 3,
    onFailure: async ({ error, event }) => {
      const { crawlId } = event.data.event.data as { crawlId: string };
      await db
        .update(schema.crawls)
        .set({
          status: "failed",
          finishedAt: new Date(),
          progress: { phase: `failed: ${error.message.slice(0, 120)}` },
        })
        .where(eq(schema.crawls.id, crawlId));
    },
  },
  async ({ event, step }) => {
    const { siteId, crawlId, url } = event.data;

    // ── Step 1: mark crawling ────────────────────────────────────────────────
    await step.run("mark-crawling", async () => {
      await db
        .update(schema.crawls)
        .set({ status: "crawling", progress: { phase: "crawling" } })
        .where(eq(schema.crawls.id, crawlId));
    });

    // ── Step 2: crawl + extract + persist pages ──────────────────────────────
    // Returns lightweight stats (not the full HTML) to keep step memo small.
    const crawlStats = await step.run("crawl-extract-persist", async () => {
      const result = await crawl(url, { maxPages: 50, concurrency: 6 });

      const extractedPages = result.pages.map((p) => ({
        ...extractPage(p.html, p.finalUrl),
        depth: p.depth,
      }));

      // Idempotent upsert: unique index on (crawl_id, url) skips duplicates.
      if (extractedPages.length > 0) {
        await db
          .insert(schema.pages)
          .values(
            extractedPages.map((p) => ({
              crawlId,
              url: p.url,
              depth: p.depth,
              title: p.title,
              metaDescription: p.metaDescription,
              og: p.og,
              canonical: p.canonical,
              lang: p.lang,
              h1: p.h1,
              mainText: p.mainText,
              contentHash: p.contentHash,
              isJsShell: p.isJsShell,
            })),
          )
          .onConflictDoNothing();
      }

      await db
        .update(schema.crawls)
        .set({
          progress: { phase: "extracting", done: extractedPages.length, total: result.pagesFound },
          stats: {
            pagesFound: result.pagesFound,
            pagesCrawled: result.pagesCrawled,
            pagesSkipped: result.pagesSkipped,
            errors: result.errors.length,
            sitemapUsed: result.sitemapUsed ? 1 : 0,
          },
        })
        .where(eq(schema.crawls.id, crawlId));

      return {
        pagesCrawled: result.pagesCrawled,
        sitemapUsed: result.sitemapUsed,
        extractedCount: extractedPages.length,
      };
    });

    // ── Step 3: curate ───────────────────────────────────────────────────────
    const curateResult = await step.run("curate", async () => {
      const dbPages = await db
        .select()
        .from(schema.pages)
        .where(eq(schema.pages.crawlId, crawlId));

      const input = dbPages.map((p) => ({
        url: p.url,
        title: p.title ?? null,
        metaDescription: p.metaDescription ?? null,
        og: (p.og as Record<string, string>) ?? {},
        canonical: p.canonical ?? null,
        lang: p.lang ?? null,
        h1: p.h1 ?? null,
        mainText: p.mainText ?? null,
        contentHash: p.contentHash ?? null,
        isJsShell: p.isJsShell,
        depth: p.depth,
      }));

      const result = curate(input, { maxPages: 40 });

      // Persist scores + page type back to DB (idempotent updates).
      for (const scored of result.scored) {
        await db
          .update(schema.pages)
          .set({ score: scored.score, pageType: scored.pageType })
          .where(
            and(
              eq(schema.pages.crawlId, crawlId),
              eq(schema.pages.url, scored.url),
            ),
          );
      }

      // Return just the shape needed for generate — no full mainText to keep memo small.
      return {
        sections: result.sections.map((s) => ({
          heading: s.heading,
          pages: s.pages.map((p) => ({
            url: p.url,
            title: p.title,
            pageType: p.pageType,
            score: p.score,
            inlinkCount: p.inlinkCount,
            description: p.description,
            metaDescription: p.metaDescription,
            mainText: p.mainText,
            contentHash: p.contentHash,
          })),
        })),
      };
    });

    // ── Step 4: generate llms.txt ────────────────────────────────────────────
    const generationResult = await step.run("generate", async () => {
      // Derive site title: title of the home page, or the hostname.
      const homePage = curateResult.sections
        .flatMap((s) => s.pages)
        .find((p) => p.pageType === "home");

      const siteTitle =
        homePage?.title ?? new URL(url).hostname.replace(/^www\./, "");

      const siteDescription =
        homePage?.metaDescription ?? homePage?.description ?? null;

      // Check description cache for pages with a content hash.
      const sections = await Promise.all(
        curateResult.sections.map(async (section) => ({
          heading: section.heading,
          pages: await Promise.all(
            section.pages.map(async (page) => {
              let description = page.description;

              if (!description && page.contentHash) {
                const cached = await db
                  .select()
                  .from(schema.pageDescriptions)
                  .where(
                    eq(schema.pageDescriptions.contentHash, page.contentHash),
                  )
                  .limit(1);
                if (cached[0]) description = cached[0].description;
              }

              return { ...page, description };
            }),
          ),
        })),
      );

      const result = generateFallback(siteTitle, siteDescription, sections as Parameters<typeof generateFallback>[2]);
      return {
        content: result.content,
        validation: result.validation,
        mode: result.mode,
      };
    });

    // ── Step 5: persist generation + mark completed ──────────────────────────
    const generation = await step.run("persist-generation", async () => {
      // Get next version number for this site (idempotent: use max+1).
      const [{ maxVersion }] = await db
        .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
        .from(schema.generations)
        .where(eq(schema.generations.siteId, siteId));

      const [inserted] = await db
        .insert(schema.generations)
        .values({
          siteId,
          crawlId,
          version: maxVersion + 1,
          content: generationResult.content,
          validation: generationResult.validation,
          mode: generationResult.mode,
        })
        .onConflictDoNothing()
        .returning();

      await db
        .update(schema.crawls)
        .set({
          status: "completed",
          finishedAt: new Date(),
          progress: { phase: "completed" },
        })
        .where(eq(schema.crawls.id, crawlId));

      return { generationId: inserted?.id, score: generationResult.validation.score };
    });

    await step.sendEvent("crawl-completed", {
      name: crawlCompleted.name,
      data: {
        siteId,
        crawlId,
        generationId: generation.generationId ?? "",
        score: generation.score,
      },
    });

    return {
      crawlStats,
      score: generation.score,
      generationId: generation.generationId,
    };
  },
);
