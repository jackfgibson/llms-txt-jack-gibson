import { and, eq, lt, sql } from "drizzle-orm";
import { inngest } from "../client";
import { db, schema } from "@/lib/db";

// Runs every minute. Any crawl still in "pending" after 60 s is considered
// stuck (Inngest failed to pick it up) and is marked failed so the UI
// doesn't spin forever.
export const timeoutStaleCrawls = inngest.createFunction(
  { id: "timeout-stale-crawls", triggers: [{ cron: "* * * * *" }] },
  async (ctx) => {
    const step = ctx.step;
    const timedOut = await step.run("mark-timed-out", async () => {
      const rows = await db
        .update(schema.crawls)
        .set({
          status: "failed",
          finishedAt: new Date(),
          progress: { phase: "failed: timed out waiting for worker" },
        })
        .where(
          and(
            eq(schema.crawls.status, "pending"),
            lt(schema.crawls.createdAt, sql`now() - interval '60 seconds'`),
          ),
        )
        .returning({ id: schema.crawls.id });

      return rows.map((r) => r.id);
    });

    return { timedOut };
  },
);
