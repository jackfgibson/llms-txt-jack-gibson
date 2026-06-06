import { crawlSite } from "./pipeline/crawl-site";
import { timeoutStaleCrawls } from "./pipeline/timeout-stale-crawls";

export const functions = [crawlSite, timeoutStaleCrawls];
