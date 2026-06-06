import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { crawlRequested } from "@/inngest/events";

export const runtime = "nodejs";

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

  const [crawl] = await db
    .insert(schema.crawls)
    .values({ siteId: site.id, status: "pending", mode: "recrawl" })
    .returning();

  await inngest.send({
    name: crawlRequested.name,
    data: { siteId: site.id, crawlId: crawl.id, url: site.url },
  });

  return NextResponse.json({ crawlId: crawl.id }, { status: 202 });
}
