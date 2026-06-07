import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
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

  // A recrawl that detected no meaningful change produces no new generation. Fall
  // back to the site's latest version so the page still shows the live file, and
  // flag it so the UI can explain that nothing was regenerated.
  let reusedGeneration = false;
  if (generations.length === 0 && crawl.status === "completed") {
    const [{ maxVersion }] = await db
      .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
      .from(schema.generations)
      .where(eq(schema.generations.siteId, crawl.siteId));

    if (maxVersion > 0) {
      generations = await db
        .select()
        .from(schema.generations)
        .where(
          and(
            eq(schema.generations.siteId, crawl.siteId),
            eq(schema.generations.version, maxVersion),
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
      validation: g.validation,
      createdAt: g.createdAt.toISOString(),
    })),
  });
}
