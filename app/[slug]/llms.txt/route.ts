import { NextRequest } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.slug, slug))
    .limit(1);

  if (!site) {
    return new Response("# Not found\n\nNo llms.txt generated for this site.\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const [generation] = await db
    .select()
    .from(schema.generations)
    .where(eq(schema.generations.siteId, site.id))
    .orderBy(desc(schema.generations.version))
    .limit(1);

  if (!generation) {
    return new Response("# Pending\n\nllms.txt has not been generated yet.\n", {
      status: 202,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return new Response(generation.content, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}
