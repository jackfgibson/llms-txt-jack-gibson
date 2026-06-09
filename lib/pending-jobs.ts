export interface PendingCrawlJob {
  type: "crawl";
  crawlId: string;
  siteId: string;
  hostname: string;
}

export interface PendingInsightJob {
  type: "insight";
  siteId: string;
  hostname: string;
}

export type PendingJob = PendingCrawlJob | PendingInsightJob;

const KEY = "crawlatlas_pending_jobs";

export function getPendingJobs(): PendingJob[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

function save(jobs: PendingJob[]) {
  localStorage.setItem(KEY, JSON.stringify(jobs));
}

export function addPendingCrawl(job: PendingCrawlJob) {
  const jobs = getPendingJobs().filter(
    (j) => !(j.type === "crawl" && j.crawlId === job.crawlId),
  );
  save([...jobs, job]);
}

export function addPendingInsight(job: PendingInsightJob) {
  const jobs = getPendingJobs().filter(
    (j) => !(j.type === "insight" && j.siteId === job.siteId),
  );
  save([...jobs, job]);
}

export function removePendingCrawl(crawlId: string) {
  save(getPendingJobs().filter((j) => !(j.type === "crawl" && j.crawlId === crawlId)));
}

export function removePendingInsight(siteId: string) {
  save(getPendingJobs().filter((j) => !(j.type === "insight" && j.siteId === siteId)));
}
