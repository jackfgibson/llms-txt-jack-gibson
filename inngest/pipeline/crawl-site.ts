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
    const { siteId, crawlId, url, providers = ["anthropic"], maxPages = 25, maxDepth = 3 } = event.data;

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

      const result = await crawl(url, { maxPages, maxDepth, concurrency: 6 });

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

      const result = curate(input, { maxPages });

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

    // ── Step 4: generate llms.txt for each selected provider in parallel ────────
    const generationResults = await step.run("generate", async () => {
      const { generateWithLlm } = await import("@/lib/llmstxt/generate-llm");
      const { generateFallback } = await import("@/lib/llmstxt/generate");

      const homePage = curateResult.sections
        .flatMap((s) => s.pages)
        .find((p) => p.pageType === "home");

      const rawSiteTitle =
        homePage?.title ?? new URL(url).hostname.replace(/^www\./, "");
      const rawSiteDescription =
        homePage?.metaDescription ?? homePage?.description ?? null;

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

      const sectionsCast = curateResult.sections as Parameters<typeof generateWithLlm>[2];

      // Run all selected providers in parallel
      const results = await Promise.all(
        providers.map(async (provider) => {
          if (provider === "fallback") {
            const r = generateFallback(rawSiteTitle, rawSiteDescription, sectionsCast);
            return { provider, content: r.content, validation: r.validation, mode: r.mode };
          }
          const r = await generateWithLlm(
            rawSiteTitle,
            rawSiteDescription,
            sectionsCast,
            cache,
            provider as "anthropic" | "openai" | "gemini",
          );
          return { provider, content: r.content, validation: r.validation, mode: r.mode };
        }),
      );

      return results;
    });

    // ── Step 5: persist all generations + mark completed ─────────────────────
    const generation = await step.run("persist-generation", async () => {
      const [{ maxVersion }] = await db
        .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
        .from(schema.generations)
        .where(eq(schema.generations.siteId, siteId));

      const version = maxVersion + 1;

      const inserted = await db
        .insert(schema.generations)
        .values(
          generationResults.map((r) => ({
            siteId,
            crawlId,
            version,
            content: r.content,
            validation: r.validation,
            mode: r.mode,
            provider: r.provider,
          })),
        )
        .onConflictDoNothing()
        .returning();

      await db
        .update(schema.crawls)
        .set({ status: "completed", finishedAt: new Date(), progress: { phase: "completed" } })
        .where(eq(schema.crawls.id, crawlId));

      const bestScore = Math.max(
        ...generationResults.map((r) => r.validation.score),
      );
      return { generationIds: inserted.map((g) => g.id), score: bestScore, version };
    });

    // ── Step 6: compute diff vs. previous crawl + write change_event ─────────
    await step.run("compute-diff", async () => {
      const { diffCrawls, isMeaningfulChange } = await import("@/lib/monitor/diff");

      // Find the most recent completed crawl for this site that isn't the current one
      const [prevCrawl] = await db
        .select({ id: schema.crawls.id })
        .from(schema.crawls)
        .where(
          and(
            eq(schema.crawls.siteId, siteId),
            eq(schema.crawls.status, "completed"),
            sql`${schema.crawls.id} != ${crawlId}`,
          ),
        )
        .orderBy(sql`${schema.crawls.finishedAt} desc nulls last`)
        .limit(1);

      if (!prevCrawl) return; // first crawl — no diff to compute

      const [prevPages, nextPages] = await Promise.all([
        db.select({ url: schema.pages.url, contentHash: schema.pages.contentHash })
          .from(schema.pages)
          .where(eq(schema.pages.crawlId, prevCrawl.id)),
        db.select({ url: schema.pages.url, contentHash: schema.pages.contentHash })
          .from(schema.pages)
          .where(eq(schema.pages.crawlId, crawlId)),
      ]);

      const diff = diffCrawls(prevPages, nextPages);
      const meaningful = isMeaningfulChange(diff);

      await db
        .insert(schema.changeEvents)
        .values({
          siteId,
          fromCrawlId: prevCrawl.id,
          toCrawlId: crawlId,
          diff: { added: diff.added, removed: diff.removed, changed: diff.changed },
          regenerated: meaningful,
        })
        .onConflictDoNothing();
    });

    await step.sendEvent("crawl-completed", {
      name: crawlCompleted.name,
      data: {
        siteId,
        crawlId,
        generationId: generation.generationIds[0] ?? "",
        score: generation.score,
      },
    });

    return { crawlStats, score: generation.score, generationIds: generation.generationIds };
  },
);
