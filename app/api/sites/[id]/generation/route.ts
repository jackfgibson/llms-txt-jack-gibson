import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const crawlId = searchParams.get("crawlId");
  const provider = searchParams.get("provider");

  if (!crawlId || !provider) {
    return NextResponse.json({ error: "crawlId and provider are required" }, { status: 400 });
  }

  const [generation] = await db
    .select({ content: schema.generations.content })
    .from(schema.generations)
    .where(
      and(
        eq(schema.generations.siteId, id),
        eq(schema.generations.crawlId, crawlId),
        eq(schema.generations.provider, provider),
      ),
    )
    .limit(1);

  if (!generation) {
    return NextResponse.json({ error: "Generation not found" }, { status: 404 });
  }

  return new Response(generation.content, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
