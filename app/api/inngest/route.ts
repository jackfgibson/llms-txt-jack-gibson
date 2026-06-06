import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Node runtime required: the crawl pipeline needs DNS + Node APIs + jsdom.
export const runtime = "nodejs";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
