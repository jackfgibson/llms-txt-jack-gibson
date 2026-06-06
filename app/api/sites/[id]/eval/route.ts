import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: siteId } = await ctx.params;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is required to run the eval loop" },
      { status: 422 },
    );
  }

  // Fetch the site
  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, siteId))
    .limit(1);

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Fetch pages from the most recent completed crawl
  const [latestCrawl] = await db
    .select({ id: schema.crawls.id })
    .from(schema.crawls)
    .where(and(eq(schema.crawls.siteId, siteId), eq(schema.crawls.status, "completed")))
    .orderBy(desc(schema.crawls.finishedAt))
    .limit(1);

  if (!latestCrawl) {
    return NextResponse.json({ error: "No completed crawl found" }, { status: 404 });
  }

  const pages = await db
    .select({
      url: schema.pages.url,
      title: schema.pages.title,
      mainText: schema.pages.mainText,
    })
    .from(schema.pages)
    .where(eq(schema.pages.crawlId, latestCrawl.id))
    .orderBy(desc(schema.pages.score))
    .limit(15);

  // Fetch the latest generation for the best provider
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
    .from(schema.generations)
    .where(eq(schema.generations.siteId, siteId));

  if (maxVersion === 0) {
    return NextResponse.json({ error: "No generation found" }, { status: 404 });
  }

  const gens = await db
    .select()
    .from(schema.generations)
    .where(and(eq(schema.generations.siteId, siteId), eq(schema.generations.version, maxVersion)));

  // Prefer LLM generation, fall back to any
  const gen = gens.find((g) => g.mode === "llm") ?? gens[0];

  if (!gen) {
    return NextResponse.json({ error: "No generation content found" }, { status: 404 });
  }

  const { runEval } = await import("@/lib/eval/eval");

  try {
    const report = await runEval(pages, gen.content);
    return NextResponse.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
