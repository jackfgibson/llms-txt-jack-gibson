import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { inngest } from "@/inngest/client";
import { crawlRequested } from "@/inngest/events";
import { slugFromUrl } from "@/lib/api/slug";

export const runtime = "nodejs";

const VALID_PROVIDERS = ["anthropic", "openai", "gemini", "fallback"] as const;

const bodySchema = z.object({
  url: z.string().url(),
  providers: z
    .array(z.enum(VALID_PROVIDERS))
    .min(1)
    .default(["anthropic", "openai", "fallback"]),
  maxPages: z.number().int().min(5).max(50).default(20),
  maxDepth: z.number().int().min(1).max(3).default(3),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  // Normalize to origin only.
  const origin = new URL(parsed.data.url).origin;
  let slug = slugFromUrl(origin);

  // Upsert site — if URL already registered, return existing site.
  let [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.url, origin))
    .limit(1);

  if (!site) {
    // Ensure slug uniqueness by appending count of existing same-slug sites.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.sites)
      .where(sql`slug LIKE ${slug + "%"}`);

    if (Number(count) > 0) slug = `${slug}-${count}`;

    // Set a daily schedule so the monitoring cron picks up this site automatically.
    [site] = await db.insert(schema.sites).values({ url: origin, slug, scheduleCron: "0 3 * * *" }).returning();
  }

  // Create a new pending crawl — store maxPages/maxDepth immediately so the UI can show them.
  const [crawl] = await db
    .insert(schema.crawls)
    .values({
      siteId: site.id,
      status: "pending",
      mode: "initial",
      providers: parsed.data.providers,
      stats: { maxPages: parsed.data.maxPages, maxDepth: parsed.data.maxDepth },
    })
    .returning();

  // Fire Inngest event (non-blocking).
  await inngest.send({
    name: crawlRequested.name,
    data: {
      siteId: site.id,
      crawlId: crawl.id,
      url: origin,
      providers: parsed.data.providers,
      maxPages: parsed.data.maxPages,
      maxDepth: parsed.data.maxDepth,
    },
  });

  return NextResponse.json(
    {
      site: {
        ...site,
        createdAt: site.createdAt.toISOString(),
      },
      crawlId: crawl.id,
    },
    { status: 201 },
  );
}
