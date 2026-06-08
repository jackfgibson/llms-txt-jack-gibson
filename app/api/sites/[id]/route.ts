import { NextRequest, NextResponse } from "next/server";
import { eq, desc, and, sql } from "drizzle-orm";
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

  // Get all generations for the latest version (one row per provider)
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(version), 0)` })
    .from(schema.generations)
    .where(eq(schema.generations.siteId, id));

  const latestGenerations =
    maxVersion > 0
      ? await db
          .select()
          .from(schema.generations)
          .where(
            and(
              eq(schema.generations.siteId, id),
              eq(schema.generations.version, maxVersion),
            ),
          )
          .orderBy(desc(schema.generations.createdAt))
      : [];

  return NextResponse.json({
    site: { ...site, createdAt: site.createdAt.toISOString() },
    latestGenerations: latestGenerations.map((g) => ({
      ...g,
      createdAt: g.createdAt.toISOString(),
    })),
    latestGeneration: latestGenerations.length > 0
      ? (() => {
          const best =
            latestGenerations.find((g) => g.provider === "anthropic") ??
            latestGenerations[0];
          return { ...best, createdAt: best.createdAt.toISOString() };
        })()
      : null,
    recentCrawls: recentCrawls.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      finishedAt: c.finishedAt?.toISOString() ?? null,
    })),
  });
}
