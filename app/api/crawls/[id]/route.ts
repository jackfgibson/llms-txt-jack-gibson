import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
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
  const generations = await db
    .select()
    .from(schema.generations)
    .where(eq(schema.generations.crawlId, id));

  return NextResponse.json({
    ...crawl,
    createdAt: crawl.createdAt.toISOString(),
    finishedAt: crawl.finishedAt?.toISOString() ?? null,
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
