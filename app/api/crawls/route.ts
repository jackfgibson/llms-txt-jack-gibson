import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export interface CrawlRun {
  crawlId: string;
  status: string;
  providers: string[];
  submittedAt: string;
}

export interface SiteGroup {
  siteId: string;
  hostname: string;
  slug: string;
  latest: CrawlRun;
  previousRuns: CrawlRun[];
}

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
    .limit(200);

  // Group by site; rows are already newest-first so first per site = latest
  const siteMap = new Map<string, SiteGroup>();

  for (const r of rows) {
    const run: CrawlRun = {
      crawlId: r.crawlId,
      status: r.status,
      providers: r.providers ?? [],
      submittedAt: r.submittedAt.toISOString(),
    };

    if (!siteMap.has(r.siteId)) {
      siteMap.set(r.siteId, {
        siteId: r.siteId,
        hostname: new URL(r.siteUrl).hostname.replace(/^www\./, ""),
        slug: r.slug,
        latest: run,
        previousRuns: [],
      });
    } else {
      siteMap.get(r.siteId)!.previousRuns.push(run);
    }
  }

  // Sort sites by their latest crawl date (already newest-first from the query)
  return NextResponse.json(Array.from(siteMap.values()));
}
