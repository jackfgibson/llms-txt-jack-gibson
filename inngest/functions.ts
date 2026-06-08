import { crawlSite } from "./pipeline/crawl-site";
import { timeoutStaleCrawls } from "./pipeline/timeout-stale-crawls";
import { scheduledRecrawl } from "./pipeline/scheduled-recrawl";
import { runInsights } from "./pipeline/run-insights";

export const functions = [crawlSite, timeoutStaleCrawls, scheduledRecrawl, runInsights];
