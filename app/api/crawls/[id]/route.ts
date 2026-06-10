import { NextRequest, NextResponse } from "next/server";
import { and, eq, lte, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const [crawl] = await db
    .select()
    .from(schema.crawls)
    .where(eq(schema.crawls.id, id))
    .limit(1);

  if (!crawl) {
    return NextResponse.json({ error: "Crawl not found" }, { status: 404 });
  }

  // Fetch generations that belong to this specific crawl (not the site's latest version)
  let generations = await db
    .select()
    .from(schema.generations)
    .where(eq(schema.generations.crawlId, id));

  // A recrawl that detected no meaningful change produces no new generation. Show
  // the version that was live AT THE TIME of this crawl — the most recent
  // generation created at or before this crawl finished — and flag it so the UI
  // can explain that nothing was regenerated. (Using max(version) would wrongly
  // surface a NEWER version produced by a LATER crawl that did find changes.)
  let reusedGeneration = false;
  if (generations.length === 0 && crawl.status === "completed") {
    const cutoff = crawl.finishedAt ?? crawl.createdAt;
    const [prior] = await db
      .select({ version: schema.generations.version })
      .from(schema.generations)
      .where(
        and(
          eq(schema.generations.siteId, crawl.siteId),
          lte(schema.generations.createdAt, cutoff),
        ),
      )
      .orderBy(desc(schema.generations.version))
      .limit(1);

    if (prior) {
      generations = await db
        .select()
        .from(schema.generations)
        .where(
          and(
            eq(schema.generations.siteId, crawl.siteId),
            eq(schema.generations.version, prior.version),
          ),
        );
      reusedGeneration = true;
    }
  }

  return NextResponse.json({
    ...crawl,
    createdAt: crawl.createdAt.toISOString(),
    finishedAt: crawl.finishedAt?.toISOString() ?? null,
    reusedGeneration,
    generations: generations.map((g) => ({
      id: g.id,
      content: g.content,
      provider: g.provider,
      mode: g.mode,
      version: g.version,
      createdAt: g.createdAt.toISOString(),
    })),
  });
}
