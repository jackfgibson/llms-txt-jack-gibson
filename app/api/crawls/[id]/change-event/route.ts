import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const [event] = await db
    .select()
    .from(schema.changeEvents)
    .where(eq(schema.changeEvents.toCrawlId, id))
    .limit(1);

  if (!event) {
    return NextResponse.json(null);
  }

  return NextResponse.json({
    id: event.id,
    fromCrawlId: event.fromCrawlId,
    toCrawlId: event.toCrawlId,
    diff: event.diff,
    regenerated: event.regenerated,
    createdAt: event.createdAt,
  });
}
