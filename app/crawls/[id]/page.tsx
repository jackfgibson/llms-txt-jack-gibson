"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { ArrowLeftIcon, CheckIcon, CopyIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";

interface Crawl {
  id: string;
  siteId: string;
  status: "pending" | "crawling" | "generating" | "completed" | "failed";
  stats: Record<string, number> | null;
  progress: { phase?: string; done?: number; total?: number } | null;
  finishedAt: string | null;
}

interface Generation {
  id: string;
  content: string;
  version: number;
  mode: string;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    score: number;
  } | null;
}

interface SiteData {
  site: { id: string; url: string; slug: string };
  latestGeneration: Generation | null;
  recentCrawls: Crawl[];
}

const PHASE_LABEL: Record<string, string> = {
  crawling: "Crawling pages",
  extracting: "Extracting content",
  curating: "Curating pages",
  generating: "Generating llms.txt",
  completed: "Complete",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "secondary",
  crawling: "secondary",
  generating: "secondary",
  completed: "outline",
  failed: "destructive",
};

function ScoreRing({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-foreground"
      : score >= 50
        ? "text-muted-foreground"
        : "text-destructive";

  return (
    <div className="flex flex-col items-center justify-center w-20 h-20 rounded-full border-2 border-border">
      <span className={`text-2xl font-bold tabular-nums leading-none ${color}`}>
        {score}
      </span>
      <span className="text-[10px] text-muted-foreground mt-0.5">/100</span>
    </div>
  );
}

export default function CrawlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: crawlId } = use(params);
  const [crawl, setCrawl] = useState<Crawl | null>(null);
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch(`/api/crawls/${crawlId}`);
        if (!res.ok) return;
        const data: Crawl = await res.json();
        setCrawl(data);

        if (data.status === "completed" || data.status === "failed") {
          const siteRes = await fetch(`/api/sites/${data.siteId}`);
          if (siteRes.ok) setSiteData(await siteRes.json());
          return;
        }
      } catch {
        // keep polling on transient errors
      }
      timer = setTimeout(poll, 2000);
    }

    poll();
    return () => clearTimeout(timer);
  }, [crawlId]);

  function copy() {
    const content = siteData?.latestGeneration?.content;
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const generation = siteData?.latestGeneration;
  const site = siteData?.site;
  const isRunning =
    !crawl ||
    crawl.status === "pending" ||
    crawl.status === "crawling" ||
    crawl.status === "generating";

  const progressPct =
    crawl?.progress?.done != null && crawl.progress.total
      ? Math.round((crawl.progress.done / crawl.progress.total) * 100)
      : null;

  const hostname = site?.url
    ? new URL(site.url).hostname.replace(/^www\./, "")
    : null;

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10 min-h-screen">
      <div className="w-full max-w-2xl space-y-8">

        {/* Back link */}
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3" />
          New generation
        </a>

        {/* Header */}
        <div className="space-y-1">
          {hostname ? (
            <h1 className="text-2xl font-semibold tracking-tight">{hostname}</h1>
          ) : (
            <div className="h-7 w-48 rounded-md bg-muted animate-pulse" />
          )}
          <div className="flex items-center gap-2">
            {crawl ? (
              <Badge variant={STATUS_VARIANT[crawl.status] ?? "secondary"}>
                {crawl.status}
              </Badge>
            ) : (
              <Badge variant="secondary">loading</Badge>
            )}
            {crawl?.stats?.sitemapUsed === 1 && (
              <span className="text-xs text-muted-foreground">via sitemap</span>
            )}
          </div>
        </div>

        {/* Progress — visible while running */}
        {isRunning && (
          <div className="rounded-xl border border-border p-6 space-y-5">
            <div className="flex items-center gap-2.5">
              <Spinner className="size-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                {crawl?.progress?.phase
                  ? (PHASE_LABEL[crawl.progress.phase] ?? crawl.progress.phase)
                  : "Starting…"}
              </span>
            </div>

            {progressPct !== null && (
              <Progress value={progressPct}>
                <ProgressLabel className="text-xs text-muted-foreground">
                  {crawl?.progress?.done} of {crawl?.progress?.total} pages
                </ProgressLabel>
                <ProgressValue className="text-xs" />
              </Progress>
            )}

            {crawl?.stats && (
              <>
                <Separator />
                <div className="grid grid-cols-3 gap-4">
                  {(
                    [
                      ["Crawled", crawl.stats.pagesCrawled],
                      ["Found", crawl.stats.pagesFound],
                      ["Errors", crawl.stats.errors],
                    ] as [string, number | undefined][]
                  ).map(([label, val]) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-lg font-semibold tabular-nums">
                        {val ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{label}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Failed */}
        {crawl?.status === "failed" && (
          <div className="rounded-xl border border-border p-6">
            <p className="text-sm text-destructive">
              The crawl failed. Check that the URL is reachable and try again.
            </p>
          </div>
        )}

        {/* Validation */}
        {generation?.validation && (
          <div className="rounded-xl border border-border p-6">
            <div className="flex items-start gap-6">
              <ScoreRing score={generation.validation.score} />
              <div className="flex-1 space-y-3 pt-1">
                <div>
                  <p className="text-sm font-medium">Spec validation</p>
                  <p className="text-xs text-muted-foreground">
                    Mode:{" "}
                    <span className="font-mono">{generation.mode}</span>
                    {" · "}Version {generation.version}
                  </p>
                </div>

                {generation.validation.errors.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CheckIcon className="size-3.5" />
                    No spec errors
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {generation.validation.errors.map((e) => (
                      <li
                        key={e}
                        className="flex items-start gap-1.5 text-xs text-destructive"
                      >
                        <XIcon className="size-3.5 mt-0.5 shrink-0" />
                        {e}
                      </li>
                    ))}
                  </ul>
                )}

                {generation.validation.warnings.map((w) => (
                  <p
                    key={w}
                    className="text-xs text-muted-foreground"
                  >
                    ⚠ {w}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* llms.txt output */}
        {generation && (
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
              <span className="text-xs font-mono text-muted-foreground">
                llms.txt
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={copy} className="h-7 gap-1.5 text-xs">
                  {copied ? (
                    <>
                      <CheckIcon className="size-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <CopyIcon className="size-3" />
                      Copy
                    </>
                  )}
                </Button>
                {site && (
                  <a
                    href={`/${site.slug}/llms.txt`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLinkIcon className="size-3" />
                    Raw
                  </a>
                )}
              </div>
            </div>

            {/* Content */}
            <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed p-5 overflow-auto max-h-[60vh] bg-background">
              {generation.content}
            </pre>
          </div>
        )}

        {/* Stats row after completion */}
        {crawl?.status === "completed" && crawl.stats && (
          <div className="grid grid-cols-3 gap-4 rounded-xl border border-border p-5">
            {(
              [
                ["Pages crawled", crawl.stats.pagesCrawled],
                ["Pages found", crawl.stats.pagesFound],
                ["Errors", crawl.stats.errors],
              ] as [string, number | undefined][]
            ).map(([label, val]) => (
              <div key={label} className="space-y-0.5">
                <p className="text-lg font-semibold tabular-nums">
                  {val ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
