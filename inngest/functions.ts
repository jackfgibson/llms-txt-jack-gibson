import { crawlSite } from "./pipeline/crawl-site";
import { timeoutStaleCrawls } from "./pipeline/timeout-stale-crawls";
import { scheduledRecrawl } from "./pipeline/scheduled-recrawl";

export const functions = [crawlSite, timeoutStaleCrawls, scheduledRecrawl];
