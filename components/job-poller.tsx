"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  getPendingJobs,
  removePendingCrawl,
  removePendingInsight,
} from "@/lib/pending-jobs";

export function JobPoller() {
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  async function checkJobs() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const jobs = getPendingJobs();
      for (const job of jobs) {
        if (job.type === "crawl") {
          try {
            const res = await fetch(`/api/crawls/${job.crawlId}`);
            if (!res.ok) continue;
            const data = await res.json();
            if (data.status === "completed") {
              removePendingCrawl(job.crawlId);
              const crawlId = job.crawlId;
              toast.success(`llms.txt ready for ${job.hostname}`, {
                description: "Generation is complete.",
                action: {
                  label: "View",
                  onClick: () => router.push(`/crawls/${crawlId}`),
                },
                duration: 8000,
              });
            } else if (data.status === "failed") {
              removePendingCrawl(job.crawlId);
              toast.error(`Generation failed for ${job.hostname}`, {
                duration: 6000,
              });
            }
          } catch {
            // ignore transient errors, retry next tick
          }
        } else if (job.type === "insight") {
          try {
            const res = await fetch(`/api/sites/${job.siteId}/insights`);
            if (!res.ok) continue;
            const data = await res.json();
            if (!data) continue;
            if (data.status === "completed") {
              removePendingInsight(job.siteId);
              const siteId = job.siteId;
              toast.success(`Insights ready for ${job.hostname}`, {
                description: "Model comparison is complete.",
                action: {
                  label: "View",
                  onClick: () => router.push(`/insights?siteId=${siteId}`),
                },
                duration: 8000,
              });
            } else if (data.status === "failed") {
              removePendingInsight(job.siteId);
              toast.error(`Insights failed for ${job.hostname}`, {
                duration: 8000,
              });
            }
          } catch {
            // ignore
          }
        }
      }
    } finally {
      runningRef.current = false;
    }
    timerRef.current = setTimeout(checkJobs, 4000);
  }

  useEffect(() => {
    timerRef.current = setTimeout(checkJobs, 4000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
