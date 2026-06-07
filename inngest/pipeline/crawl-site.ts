import { and, eq, ne, sql, desc, isNotNull } from "drizzle-orm";
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

    // ── Step 0: resolve crawl params ─────────────────────────────────────────
    // Recrawls (manual "Re-check now" + scheduled cron) don't carry providers or
    // bounds, so reuse the site's most recent crawl that did. Persist the resolved
    // providers on this crawl row so the UI history renders the right logos.
    const { providers, maxPages, maxDepth } = await step.run("resolve-params", async () => {
      let providers = event.data.providers;
      let maxPages = event.data.maxPages;
      let maxDepth = event.data.maxDepth;

      if (!providers || maxPages == null || maxDepth == null) {
        const [prev] = await db
          .select({ providers: schema.crawls.providers, stats: schema.crawls.stats })
          .from(schema.crawls)
          .where(
            and(
              eq(schema.crawls.siteId, siteId),
              ne(schema.crawls.id, crawlId),
              isNotNull(schema.crawls.providers),
            ),
          )
          .orderBy(desc(schema.crawls.createdAt))
          .limit(1);

        providers = providers ?? prev?.providers ?? ["anthropic"];
        maxPages = maxPages ?? prev?.stats?.maxPages ?? 25;
        maxDepth = maxDepth ?? prev?.stats?.maxDepth ?? 3;
      }

      await db
        .update(schema.crawls)
        .set({ providers })
        .where(eq(schema.crawls.id, crawlId));

      return { providers, maxPages, maxDepth };
    });

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

      const result = await crawl(url, { maxPages, maxDepth });

      // Crawl is lenient: auth/not-found failures alone don't fail it. But if we
      // got zero usable pages, there's nothing to generate from — fail so the
      // crawl is marked failed rather than producing an empty llms.txt.
      if (result.pages.length === 0) {
        throw new Error(result.error ?? "Crawl found no pages");
      }

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
            maxPages,
            maxDepth,
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

    // ── Step 4: diff vs. previous crawl + decide whether to regenerate ───────
    // Running the diff BEFORE generation lets a recrawl with no meaningful change
    // skip the (expensive) LLM step entirely while still recording a change_event.
    const decision = await step.run("decide-regen", async () => {
      const { diffCrawls, isMeaningfulChange } = await import("@/lib/monitor/diff");

      // Most recent completed crawl for this site, excluding the current one.
      const [prevCrawl] = await db
        .select({ id: schema.crawls.id })
        .from(schema.crawls)
        .where(
          and(
            eq(schema.crawls.siteId, siteId),
            eq(schema.crawls.status, "completed"),
            ne(schema.crawls.id, crawlId),
          ),
        )
        .orderBy(sql`${schema.crawls.finishedAt} desc nulls last`)
        .limit(1);

      // First crawl ever — always generate, no diff to record.
      if (!prevCrawl) return { shouldGenerate: true };

      // Is there an existing generation we could keep serving if nothing changed?
      const [{ genCount }] = await db
        .select({ genCount: sql<number>`count(*)` })
        .from(schema.generations)
        .where(eq(schema.generations.siteId, siteId));
      const siteHasGeneration = Number(genCount) > 0;

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
      // Regenerate on meaningful change, or if the site somehow has no generation
      // to serve yet (e.g. a prior generation failed).
      const shouldGenerate = meaningful || !siteHasGeneration;

      // Idempotent across retries via the unique index on (to_crawl_id).
      await db
        .insert(schema.changeEvents)
        .values({
          siteId,
          fromCrawlId: prevCrawl.id,
          toCrawlId: crawlId,
          diff: { added: diff.added, removed: diff.removed, changed: diff.changed },
          regenerated: shouldGenerate,
        })
        .onConflictDoNothing();

      return { shouldGenerate };
    });

    // ── Step 5: generate + persist (only when regenerating) ──────────────────
    let outcome: { generationIds: string[]; score: number; version: number };

    if (decision.shouldGenerate) {
      await step.run("mark-generating", async () => {
        await db
          .update(schema.crawls)
          .set({ status: "generating", progress: { phase: "generating" } })
          .where(eq(schema.crawls.id, crawlId));
      });

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

        // Run all selected providers in parallel.
        return Promise.all(
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
      });

      outcome = await step.run("persist-generation", async () => {
        // Idempotent version: if this crawl already produced generations (i.e. a
        // prior attempt of this step inserted them), reuse that version instead of
        // computing a fresh max()+1, which would create duplicate rows on retry.
        const existing = await db
          .select({ version: schema.generations.version })
          .from(schema.generations)
          .where(eq(schema.generations.crawlId, crawlId))
          .limit(1);

        let version: number;
        if (existing.length > 0) {
          version = existing[0].version;
        } else {
          const [{ maxVersion }] = await db
            .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
            .from(schema.generations)
            .where(eq(schema.generations.siteId, siteId));
          version = maxVersion + 1;
        }

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

        const bestScore = Math.max(...generationResults.map((r) => r.validation.score));
        return { generationIds: inserted.map((g) => g.id), score: bestScore, version };
      });
    } else {
      // No meaningful change — keep the existing live generation, just complete.
      outcome = await step.run("complete-no-regen", async () => {
        await db
          .update(schema.crawls)
          .set({ status: "completed", finishedAt: new Date(), progress: { phase: "completed" } })
          .where(eq(schema.crawls.id, crawlId));

        const [latest] = await db
          .select()
          .from(schema.generations)
          .where(eq(schema.generations.siteId, siteId))
          .orderBy(desc(schema.generations.version))
          .limit(1);

        return {
          generationIds: latest ? [latest.id] : [],
          score: latest?.validation?.score ?? 0,
          version: latest?.version ?? 0,
        };
      });
    }

    await step.sendEvent("crawl-completed", {
      name: crawlCompleted.name,
      data: {
        siteId,
        crawlId,
        generationId: outcome.generationIds[0] ?? "",
        score: outcome.score,
      },
    });

    return {
      crawlStats,
      score: outcome.score,
      generationIds: outcome.generationIds,
      regenerated: decision.shouldGenerate,
    };
  },
);
