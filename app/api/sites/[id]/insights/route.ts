import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { insightsRequested } from "@/inngest/events";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const [insight] = await db
    .select()
    .from(schema.insights)
    .where(eq(schema.insights.siteId, id))
    .orderBy(desc(schema.insights.createdAt))
    .limit(1);

  if (!insight) {
    return NextResponse.json(null, { status: 200 });
  }

  const evalResults = await db
    .select()
    .from(schema.modelEvalResults)
    .where(eq(schema.modelEvalResults.insightId, insight.id));

  return NextResponse.json({ ...insight, evalResults }, { status: 200 });
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.id, id))
    .limit(1);

  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  // Find most recent completed crawl that has generations for all 3 LLM providers
  const llmProviders = ["anthropic", "openai", "gemini"];

  const allCrawls = await db
    .select({ id: schema.crawls.id })
    .from(schema.crawls)
    .where(and(eq(schema.crawls.siteId, id), eq(schema.crawls.status, "completed")))
    .orderBy(desc(schema.crawls.createdAt));

  let eligibleCrawlId: string | null = null;
  for (const crawl of allCrawls) {
    const gens = await db
      .select({ provider: schema.generations.provider })
      .from(schema.generations)
      .where(eq(schema.generations.crawlId, crawl.id));
    const hasAll = llmProviders.every((p) => gens.some((g) => g.provider === p));
    if (hasAll) {
      eligibleCrawlId = crawl.id;
      break;
    }
  }

  if (!eligibleCrawlId) {
    return NextResponse.json(
      { error: "No eligible crawl found (need all 3 LLM providers)" },
      { status: 422 },
    );
  }

  // Upsert insights row
  const [existing] = await db
    .select()
    .from(schema.insights)
    .where(
      and(
        eq(schema.insights.siteId, id),
        eq(schema.insights.crawlId, eligibleCrawlId),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.status === "completed" || existing.status === "pending" || existing.status === "running") {
      const evalResults = existing.status === "completed"
        ? await db
            .select()
            .from(schema.modelEvalResults)
            .where(eq(schema.modelEvalResults.insightId, existing.id))
        : [];
      return NextResponse.json(
        { ...existing, evalResults },
        { status: existing.status === "completed" ? 200 : 202 },
      );
    }
  }

  const [insight] = await db
    .insert(schema.insights)
    .values({ siteId: id, crawlId: eligibleCrawlId, status: "pending" })
    .onConflictDoNothing()
    .returning();

  const insightId = insight?.id ?? existing!.id;

  await inngest.send({
    name: insightsRequested.name,
    data: { insightId, siteId: id, crawlId: eligibleCrawlId },
  });

  return NextResponse.json({ insightId, status: "pending" }, { status: 202 });
}
