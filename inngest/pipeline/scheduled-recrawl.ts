import { eq, isNotNull } from "drizzle-orm";
import { inngest } from "../client";
import { crawlRequested } from "../events";
import { db, schema } from "@/lib/db";

/**
 * Daily cron: re-crawl any site that has schedule_cron set.
 * Fires at 03:00 UTC every day.
 */
export const scheduledRecrawl = inngest.createFunction(
  {
    id: "scheduled-recrawl",
    triggers: [{ cron: "0 3 * * *" }],
  },
  async (ctx) => {
    const step = ctx.step;

    const sites = await step.run("fetch-scheduled-sites", async () => {
      return db
        .select({ id: schema.sites.id, url: schema.sites.url })
        .from(schema.sites)
        .where(isNotNull(schema.sites.scheduleCron));
    });

    if (sites.length === 0) return { enqueued: 0 };

    const enqueued = await step.run("enqueue-recrawls", async () => {
      const crawls = await db
        .insert(schema.crawls)
        .values(
          sites.map((s) => ({ siteId: s.id, status: "pending" as const, mode: "recrawl" as const, automated: true })),
        )
        .returning({ id: schema.crawls.id, siteId: schema.crawls.siteId });

      await inngest.send(
        crawls.map((c) => {
          const site = sites.find((s) => s.id === c.siteId)!;
          return {
            name: crawlRequested.name,
            data: {
              siteId: c.siteId,
              crawlId: c.id,
              url: site.url,
              automated: true,
            },
          };
        }),
      );

      return crawls.length;
    });

    return { enqueued };
  },
);
