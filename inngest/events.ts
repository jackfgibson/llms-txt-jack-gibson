import { eventType, staticSchema } from "inngest";

export const crawlRequested = eventType("site/crawl.requested", {
  schema: staticSchema<{
    siteId: string;
    crawlId: string;
    url: string;
  }>(),
});

export const crawlCompleted = eventType("site/crawl.completed", {
  schema: staticSchema<{
    siteId: string;
    crawlId: string;
    generationId: string;
    score: number;
  }>(),
});
