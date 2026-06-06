import { and, eq, sql } from "drizzle-orm";
import { inngest } from "../client";
import { crawlRequested, crawlCompleted } from "../events";
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
    const crawlStats = await step.run("crawl-extract-persist", async () => {
      const { crawl } = await import("@/lib/crawler/crawl");
      const { extractPage } = await import("@/lib/extract/extract");

      const result = await crawl(url, { maxPages: 50, concurrency: 6 });

      const extractedPages = result.pages.map((p) => ({
        ...extractPage(p.html, p.finalUrl),
        depth: p.depth,
      }));

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
      const { curate } = await import("@/lib/curate/curate");

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

    // ── Step 3.5: mark generating ────────────────────────────────────────────
    await step.run("mark-generating", async () => {
      await db
        .update(schema.crawls)
        .set({ status: "generating", progress: { phase: "generating" } })
        .where(eq(schema.crawls.id, crawlId));
    });

    // ── Step 4: generate llms.txt ────────────────────────────────────────────
    const generationResult = await step.run("generate", async () => {
      const { generateWithLlm } = await import("@/lib/llmstxt/generate-llm");

      const homePage = curateResult.sections
        .flatMap((s) => s.pages)
        .find((p) => p.pageType === "home");

      const rawSiteTitle =
        homePage?.title ?? new URL(url).hostname.replace(/^www\./, "");
      const rawSiteDescription =
        homePage?.metaDescription ?? homePage?.description ?? null;

      // DB-backed description cache adapter (content_hash → description)
      const cache = {
        async get(contentHash: string) {
          const rows = await db
            .select()
            .from(schema.pageDescriptions)
            .where(eq(schema.pageDescriptions.contentHash, contentHash))
            .limit(1);
          return rows[0]
            ? { description: rows[0].description, provenance: rows[0].provenance ?? "" }
            : null;
        },
        async set(contentHash: string, description: string, provenance: string) {
          await db
            .insert(schema.pageDescriptions)
            .values({ contentHash, description, provenance })
            .onConflictDoNothing();
        },
      };

      const result = await generateWithLlm(
        rawSiteTitle,
        rawSiteDescription,
        curateResult.sections as Parameters<typeof generateWithLlm>[2],
        cache,
      );

      return { content: result.content, validation: result.validation, mode: result.mode };
    });

    // ── Step 5: persist generation + mark completed ──────────────────────────
    const generation = await step.run("persist-generation", async () => {
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
        .set({ status: "completed", finishedAt: new Date(), progress: { phase: "completed" } })
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

    return { crawlStats, score: generation.score, generationId: generation.generationId };
  },
);
