import { NextRequest, NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
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

  const recentCrawls = await db
    .select()
    .from(schema.crawls)
    .where(eq(schema.crawls.siteId, id))
    .orderBy(desc(schema.crawls.createdAt))
    .limit(10);

  const [latestGeneration] = await db
    .select()
    .from(schema.generations)
    .where(eq(schema.generations.siteId, id))
    .orderBy(desc(schema.generations.version))
    .limit(1);

  return NextResponse.json({
    site: { ...site, createdAt: site.createdAt.toISOString() },
    latestGeneration: latestGeneration
      ? {
          ...latestGeneration,
          createdAt: latestGeneration.createdAt.toISOString(),
        }
      : null,
    recentCrawls: recentCrawls.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      finishedAt: c.finishedAt?.toISOString() ?? null,
    })),
  });
}
