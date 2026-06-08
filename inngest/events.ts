import { eventType, staticSchema } from "inngest";

export const crawlRequested = eventType("site/crawl.requested", {
  schema: staticSchema<{
    siteId: string;
    crawlId: string;
    url: string;
    // Optional: recrawls (manual + scheduled) omit these and the pipeline carries
    // them over from the site's previous crawl.
    providers?: string[]; // ["anthropic", "openai", "fallback"]
    maxPages?: number;
    maxDepth?: number;
  }>(),
});

export const crawlCompleted = eventType("site/crawl.completed", {
  schema: staticSchema<{
    siteId: string;
    crawlId: string;
    generationId: string;
  }>(),
});

export const insightsRequested = eventType("site/insights.requested", {
  schema: staticSchema<{
    insightId: string;
    siteId: string;
    crawlId: string;
  }>(),
});

export const insightsCompleted = eventType("site/insights.completed", {
  schema: staticSchema<{
    insightId: string;
    siteId: string;
    winner: string;
  }>(),
});
