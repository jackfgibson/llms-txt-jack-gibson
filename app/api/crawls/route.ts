import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const rows = await db
    .select({
      crawlId: schema.crawls.id,
      status: schema.crawls.status,
      providers: schema.crawls.providers,
      submittedAt: schema.crawls.createdAt,
      siteId: schema.sites.id,
      siteUrl: schema.sites.url,
      slug: schema.sites.slug,
    })
    .from(schema.crawls)
    .innerJoin(schema.sites, eq(schema.crawls.siteId, schema.sites.id))
    .orderBy(desc(schema.crawls.createdAt))
    .limit(100);

  return NextResponse.json(
    rows.map((r) => ({
      crawlId: r.crawlId,
      siteId: r.siteId,
      slug: r.slug,
      hostname: new URL(r.siteUrl).hostname.replace(/^www\./, ""),
      providers: r.providers ?? [],
      status: r.status,
      submittedAt: r.submittedAt.toISOString(),
    })),
  );
}
