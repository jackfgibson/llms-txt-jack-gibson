"use client";

import { useEffect, useRef, useState } from "react";
import { use } from "react";
import ReactMarkdown from "react-markdown";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, MoreHorizontalIcon, RefreshCwIcon, SparklesIcon, TelescopeIcon } from "lucide-react";
import { FaviconImg } from "@/components/favicon-img";
import { addPendingCrawl, addPendingInsight, removePendingCrawl, removePendingInsight } from "@/lib/pending-jobs";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Progress,
  ProgressLabel,
  ProgressValue,
} from "@/components/ui/progress";

interface Crawl {
  id: string;
  siteId: string;
  status: "pending" | "crawling" | "generating" | "completed" | "failed";
  automated: boolean;
  stats: Record<string, number> | null;
  progress: { phase?: string; done?: number; total?: number } | null;
  providers: string[] | null;
  createdAt: string;
  finishedAt: string | null;
  generations: Generation[]; // crawl-specific, or the site's latest if not regenerated
  reusedGeneration?: boolean; // true when a recrawl found no change and kept the live file
}

interface Generation {
  id: string;
  content: string;
  version: number;
  mode: string;
  provider: string;
}

interface SiteData {
  site: { id: string; url: string; slug: string; faviconUrl?: string | null };
  recentCrawls: Crawl[];
}

interface ChangeEvent {
  id: string;
  fromCrawlId: string | null;
  toCrawlId: string;
  diff: { added: string[]; removed: string[]; changed: string[] } | null;
  regenerated: boolean;
  createdAt: string;
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

const PROVIDER_META: Record<string, { logo: string; label: string }> = {
  anthropic: { logo: "/providers/claude.png",   label: "Claude" },
  openai:    { logo: "/providers/openai.png",    label: "GPT" },
  gemini:    { logo: "/providers/gemini.png",    label: "Gemini" },
  fallback:  { logo: "/providers/fallback.png",  label: "Non-LLM" },
};

const PROVIDER_MODEL: Record<string, string> = {
  anthropic: "Claude Haiku",
  openai:    "GPT-4o mini",
  gemini:    "Gemini 3 Flash",
  fallback:  "Non-LLM",
};

const PROVIDER_FILENAME: Record<string, string> = {
  anthropic: "claude",
  openai:    "chatgpt",
  gemini:    "gemini",
  fallback:  "deterministic",
};

function GenerationPanel({
  generation,
  slug,
  hostname,
  isLatest,
}: {
  generation: Generation;
  slug: string | null;
  hostname: string | null;
  isLatest: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<"raw" | "markdown">("raw");

  function copy() {
    navigator.clipboard.writeText(generation.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([generation.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${PROVIDER_FILENAME[generation.provider] ?? generation.provider}_llms.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Content */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-mono text-muted-foreground">
              llms.txt
              {!isLatest && (
                <span className="ml-2 text-amber-600 dark:text-amber-400">(historical — not the live version)</span>
              )}
            </span>
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[view]}
              onValueChange={(value: string[]) => {
                if (value.length > 0) setView(value[0] as "raw" | "markdown");
              }}
              aria-label="View mode"
            >
              <ToggleGroupItem value="raw" className="h-6 px-2 text-[10px]">
                RAW
              </ToggleGroupItem>
              <ToggleGroupItem value="markdown" className="h-6 px-2 text-[10px]">
                MARKDOWN
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={copy} className="h-7 gap-1.5 text-xs">
              {copied ? (
                <><CheckIcon className="size-3" />Copied</>
              ) : (
                <><CopyIcon className="size-3" />Copy</>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={download} className="h-7 gap-1.5 text-xs">
              <DownloadIcon className="size-3" />
              Download
            </Button>
            {slug && isLatest && (
              <a
                href={`/${slug}/llms.txt`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                <ExternalLinkIcon className="size-3" />
                Live URL
              </a>
            )}
          </div>
        </div>
        {view === "markdown" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-5 overflow-auto max-h-[60vh] bg-background">
            <ReactMarkdown>{generation.content}</ReactMarkdown>
          </div>
        ) : (
          <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed p-5 overflow-auto max-h-[60vh] bg-background">
            {generation.content}
          </pre>
        )}
      </div>
    </div>
  );
}

export default function CrawlPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: crawlId } = use(params);
  const router = useRouter();
  const [crawl, setCrawl] = useState<Crawl | null>(null);
  const [siteData, setSiteData] = useState<SiteData | null>(null);
  const [changeEvent, setChangeEvent] = useState<ChangeEvent | null | undefined>(undefined);
  type InsightStatus = "none" | "pending" | "running" | "completed" | "failed";
  const [insightStatus, setInsightStatus] = useState<InsightStatus>("none");
  const [recrawling, setRecrawling] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [generatingInsights, setGeneratingInsights] = useState(false);
  // Track status across polls so we only toast on a watched run→finished transition,
  // not when opening an already-finished crawl.
  const prevStatusRef = useRef<Crawl["status"] | null>(null);
  const hostnameRef = useRef<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let siteDataLoaded = false;

    async function poll() {
      try {
        const res = await fetch(`/api/crawls/${crawlId}`);
        if (!res.ok) return;
        const data: Crawl = await res.json();
        const wasRunning =
          prevStatusRef.current === "pending" ||
          prevStatusRef.current === "crawling" ||
          prevStatusRef.current === "generating";
        prevStatusRef.current = data.status;
        setCrawl(data);

        // Fetch site data on the first poll so history is visible immediately,
        // even while the crawl is still pending/running.
        if (!siteDataLoaded) {
          siteDataLoaded = true;
          const siteRes = await fetch(`/api/sites/${data.siteId}`);
          if (siteRes.ok) {
            const sd: SiteData = await siteRes.json();
            setSiteData(sd);
            hostnameRef.current = new URL(sd.site.url).hostname.replace(/^www\./, "");
          }
        }

        if (data.status === "completed" || data.status === "failed") {
          // Remove pending crawl job — this page has observed the result
          removePendingCrawl(crawlId);
          // Re-fetch site data on completion to pick up new generation
          const siteRes = await fetch(`/api/sites/${data.siteId}`);
          if (siteRes.ok) {
            const sd: SiteData = await siteRes.json();
            setSiteData(sd);
            hostnameRef.current = new URL(sd.site.url).hostname.replace(/^www\./, "");
          }
          // Toast only when this page watched the crawl run to completion.
          // id matches the JobPoller toast so the two can never double-fire.
          if (wasRunning && data.status === "completed") {
            toast.success(`llms.txt ready for ${hostnameRef.current ?? "site"}`, {
              id: `crawl-${crawlId}`,
              description: "Generation is complete.",
              duration: 8000,
            });
          } else if (wasRunning && data.status === "failed") {
            toast.error(`Generation failed for ${hostnameRef.current ?? "site"}`, {
              id: `crawl-${crawlId}`,
              duration: 6000,
            });
          }
          // Fetch change_event for this crawl
          const evRes = await fetch(`/api/crawls/${crawlId}/change-event`);
          if (evRes.ok) {
            const ev = await evRes.json();
            setChangeEvent(ev ?? null);
          } else {
            setChangeEvent(null);
          }
          // Fetch insight status scoped to this specific crawl
          if (data.status === "completed") {
            const insightRes = await fetch(`/api/sites/${data.siteId}/insights?crawlId=${crawlId}`);
            if (insightRes.ok) {
              const insight = await insightRes.json();
              if (insight) {
                setInsightStatus(insight.status as InsightStatus);
                if (insight.status === "completed" || insight.status === "failed") {
                  removePendingInsight(data.siteId);
                }
              } else {
                setInsightStatus("none");
              }
            }
          }
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

  // Poll insight status while it is in-progress (crawl poll has already stopped by this point)
  useEffect(() => {
    if (!crawl?.siteId) return;
    if (insightStatus !== "pending" && insightStatus !== "running") return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/sites/${crawl.siteId}/insights?crawlId=${crawlId}`);
      if (!res.ok) return;
      const insight = await res.json();
      if (!insight) return;
      setInsightStatus(insight.status as InsightStatus);
      if (insight.status === "completed" || insight.status === "failed") {
        removePendingInsight(crawl.siteId);
        // This effect only runs while we watch a pending/running insight, so this
        // is a genuine transition. id matches the JobPoller toast to avoid doubles.
        const siteId = crawl.siteId;
        if (insight.status === "completed") {
          toast.success(`Insights ready for ${hostname ?? "site"}`, {
            id: `insight-${siteId}`,
            description: "Model comparison is complete.",
            action: {
              label: "View",
              onClick: () => router.push(`/insights?siteId=${siteId}`),
            },
            duration: 8000,
          });
        } else {
          toast.error(`Insights failed for ${hostname ?? "site"}`, {
            id: `insight-${siteId}`,
            duration: 8000,
          });
        }
      }
    }, 3000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crawl?.siteId, crawlId, insightStatus]);

  async function handleRecrawl() {
    if (!crawl || !siteData) return;
    setRecrawling(true);
    try {
      const res = await fetch(`/api/sites/${crawl.siteId}/crawl`, { method: "POST" });
      if (!res.ok) {
        toast.error("Re-crawl failed", { description: "Could not start a new crawl.", duration: 8000 });
        return;
      }
      const { crawlId: newId } = await res.json();
      addPendingCrawl({ type: "crawl", crawlId: newId, siteId: crawl.siteId, hostname: hostname ?? "site" });
      toast("Re-crawl started!", {
        description: "A new crawl is running. Redirecting…",
        duration: 5000,
      });
      router.push(`/crawls/${newId}`);
    } catch {
      toast.error("Network error — please try again", { duration: 5000 });
    } finally {
      setRecrawling(false);
    }
  }

  async function handleGenerateInsights() {
    if (!crawl) return;
    setGeneratingInsights(true);
    try {
      const res = await fetch(`/api/sites/${crawl.siteId}/insights`, { method: "POST" });
      if (!res.ok) {
        toast.error("Could not trigger insights — please try again", { duration: 5000 });
        return;
      }
      setInsightStatus("pending");
      addPendingInsight({ type: "insight", siteId: crawl.siteId, hostname: hostname ?? "site" });
      const siteId = crawl.siteId;
      toast("Insights generation started!", {
        description: "This may take up to 30 seconds.",
        action: {
          label: "View progress →",
          onClick: () => router.push(`/insights?siteId=${siteId}`),
        },
        duration: 6000,
      });
    } catch {
      toast.error("Network error — please try again", { duration: 5000 });
    } finally {
      setGeneratingInsights(false);
    }
  }

  function triggerDownload(filename: string, content: string) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownloadSingle(provider: string) {
    const gen = generations.find((g) => g.provider === provider);
    if (!gen) return;
    triggerDownload(`${PROVIDER_FILENAME[provider] ?? provider}_llms.txt`, gen.content);
  }

  async function handleDownloadAll() {
    if (generations.length === 0) return;
    setDownloading(true);
    try {
      if (generations.length === 1) {
        handleDownloadSingle(generations[0].provider);
        return;
      }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const name = hostname ?? "site";
      for (const gen of generations) {
        zip.file(`${PROVIDER_FILENAME[gen.provider] ?? gen.provider}_llms.txt`, gen.content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}_llms_txt.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "fallback"];
  const LLM_PROVIDERS = ["anthropic", "openai", "gemini"];
  const isInsightsEligible =
    crawl?.status === "completed" &&
    LLM_PROVIDERS.every((p) => crawl.providers?.includes(p));

  // Use this crawl's own generations — not the site's latest version
  const generations = (crawl?.generations ?? []).slice().sort(
    (a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider),
  );
  const site = siteData?.site;

  // A crawl's generation is "live" only if no later completed crawl exists for this site.
  // A later failed/pending run does NOT demote the most recent completed run.
  const thisIndex = siteData?.recentCrawls.findIndex((c) => c.id === crawlId) ?? -1;
  const newerCompletedExists =
    thisIndex > 0 &&
    (siteData?.recentCrawls.slice(0, thisIndex).some((c) => c.status === "completed") ?? false);
  const isLatestCrawl = !newerCompletedExists;
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

  const defaultTab = generations[0]?.provider ?? "anthropic";

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10 min-h-screen">
      <div className="w-full max-w-2xl space-y-8">

        {/* Back link */}
        <a
          href="/results"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3" />
          All results
        </a>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {hostname ? (
              <div className="flex items-center gap-2">
                <FaviconImg src={siteData?.site.faviconUrl ?? null} size="md" />
                <a
                  href={site?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-1.5 hover:underline"
                >
                  <h1 className="text-2xl font-semibold tracking-tight">{hostname}</h1>
                  <ExternalLinkIcon className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
                </a>
              </div>
            ) : (
              <div className="h-7 w-48 rounded-md bg-muted animate-pulse" />
            )}
            <div className="flex items-center gap-2">
              {crawl ? (
                <Badge
                  variant={STATUS_VARIANT[crawl.status] ?? "secondary"}
                  className={crawl.status === "completed" ? "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400" : undefined}
                >
                  {crawl.status}
                </Badge>
              ) : (
                <Badge variant="secondary">loading</Badge>
              )}
            </div>
          </div>

          {crawl?.status === "completed" && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Download dropdown */}
              {generations.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={downloading}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent transition-colors disabled:pointer-events-none disabled:opacity-50"
                  >
                    {downloading ? <Spinner className="size-3.5" /> : <DownloadIcon className="size-3.5" />}
                    Download
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-72">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>This run</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {generations.map((g) => {
                        const meta = PROVIDER_META[g.provider];
                        return (
                          <DropdownMenuItem key={g.provider} onClick={() => handleDownloadSingle(g.provider)} className="gap-2">
                            <DownloadIcon className="size-3.5" />
                            <img src={meta?.logo ?? "/providers/fallback.png"} alt="" className="w-4 h-4 object-contain" style={{ imageRendering: "pixelated" }} />
                            {PROVIDER_MODEL[g.provider] ?? g.provider} — llms.txt
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuGroup>
                    {generations.length > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={handleDownloadAll} className="gap-2">
                          <DownloadIcon className="size-3.5" />
                          All providers — .zip
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Generate: only on the most recent eligible crawl with no existing insights */}
              {isInsightsEligible && isLatestCrawl && (insightStatus === "none" || insightStatus === "failed") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateInsights}
                  disabled={generatingInsights}
                  className="gap-1.5"
                >
                  {generatingInsights ? <Spinner className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
                  Generate Insights
                </Button>
              )}

              {/* View/Running: whenever this crawl has associated insights, regardless of age */}
              {(insightStatus === "completed" || insightStatus === "pending" || insightStatus === "running") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => router.push(`/insights?siteId=${crawl.siteId}`)}
                  className="gap-1.5"
                >
                  {(insightStatus === "pending" || insightStatus === "running")
                    ? <Spinner className="size-3.5" />
                    : <TelescopeIcon className="size-3.5" />
                  }
                  {insightStatus === "completed" ? "View Insights" : "Insights Running…"}
                </Button>
              )}

              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRecrawl}
                      disabled={recrawling}
                      className="gap-1.5"
                    />
                  }
                >
                  {recrawling ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
                  Re-crawl now
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-64 text-center">
                  Re-crawls the site. If the crawler reaches different pages, or a
                  previously reached page&apos;s content has changed, the llms.txt
                  files are regenerated.
                </TooltipContent>
              </Tooltip>
            </div>
          )}
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
          </div>
        )}

        {/* Failed */}
        {crawl?.status === "failed" && (
          <div className="rounded-xl border border-border p-6">
            <p className="text-sm text-destructive">
              The crawl failed. The site is either unreachable, or is blocking our crawlers.
            </p>
          </div>
        )}

        {/* Carried-over notice — recrawl with no meaningful change */}
        {crawl?.status === "completed" && crawl.reusedGeneration && generations.length > 0 && (
          <p className="text-xs text-muted-foreground">
            No content changes since the last crawl — showing the current live version
            {generations[0]?.version ? ` (v${generations[0].version})` : ""}.
          </p>
        )}

        {/* Results — one tab per provider */}
        {generations.length > 0 && (
          <Tabs defaultValue={defaultTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                {generations.map((g) => {
                  const meta = PROVIDER_META[g.provider] ?? {
                    logo: "/providers/fallback.png",
                    label: g.provider,
                  };
                  return (
                    <TabsTrigger key={g.provider} value={g.provider} className="gap-2">
                      <img
                        src={meta.logo}
                        alt={meta.label}
                        className="w-6 h-6 object-contain"
                        style={{ imageRendering: "pixelated" }}
                      />
                      {meta.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>

              {crawl?.stats?.maxPages != null && (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground tabular-nums">{crawl.stats.maxPages}</span>
                    {" "}max pages
                  </span>
                  <span>
                    <span className="font-semibold text-foreground tabular-nums">{crawl.stats.maxDepth ?? "—"}</span>
                    {" "}max depth
                  </span>
                </div>
              )}
            </div>

            {generations.map((g) => (
              <TabsContent key={g.provider} value={g.provider}>
                <GenerationPanel
                  generation={g}
                  slug={site?.slug ?? null}
                  hostname={hostname}
                  isLatest={isLatestCrawl}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}

        {/* Diff panel — only when change_event exists (recrawl) */}
        {changeEvent && (() => {
          const diff = changeEvent.diff;
          const isEmpty =
            !diff ||
            (diff.added.length === 0 &&
              diff.removed.length === 0 &&
              diff.changed.length === 0);

          // Default to whichever tab has content
          const defaultDiffTab =
            diff && diff.added.length > 0
              ? "added"
              : diff && diff.removed.length > 0
                ? "removed"
                : "changed";

          return (
            <div className="rounded-xl border border-border p-5 space-y-3">
              <p className="text-sm font-medium">Changes since last crawl</p>

              {isEmpty ? (
                <p className="text-xs text-muted-foreground">No content changes detected.</p>
              ) : (
                <Tabs defaultValue={defaultDiffTab}>
                  <TabsList className="mb-3">
                    {diff!.added.length > 0 && (
                      <TabsTrigger value="added" className="gap-1.5 text-xs">
                        <span className="font-semibold text-green-700 dark:text-green-400">+{diff!.added.length}</span>
                        Added
                      </TabsTrigger>
                    )}
                    {diff!.removed.length > 0 && (
                      <TabsTrigger value="removed" className="gap-1.5 text-xs">
                        <span className="font-semibold text-destructive">−{diff!.removed.length}</span>
                        Removed
                      </TabsTrigger>
                    )}
                    {diff!.changed.length > 0 && (
                      <TabsTrigger value="changed" className="gap-1.5 text-xs">
                        <span className="font-semibold text-amber-700 dark:text-amber-400">~{diff!.changed.length}</span>
                        Changed
                      </TabsTrigger>
                    )}
                  </TabsList>

                  {diff!.added.length > 0 && (
                    <TabsContent value="added">
                      <ScrollArea className="h-48 rounded-md border border-border">
                        <ul className="p-3 space-y-1">
                          {diff!.added.map((u) => (
                            <li key={u} className="text-xs font-mono text-muted-foreground break-all">{u}</li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </TabsContent>
                  )}

                  {diff!.removed.length > 0 && (
                    <TabsContent value="removed">
                      <ScrollArea className="h-48 rounded-md border border-border">
                        <ul className="p-3 space-y-1">
                          {diff!.removed.map((u) => (
                            <li key={u} className="text-xs font-mono text-muted-foreground break-all">{u}</li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </TabsContent>
                  )}

                  {diff!.changed.length > 0 && (
                    <TabsContent value="changed">
                      <ScrollArea className="h-48 rounded-md border border-border">
                        <ul className="p-3 space-y-1">
                          {diff!.changed.map((u) => (
                            <li key={u} className="text-xs font-mono text-muted-foreground break-all">{u}</li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </TabsContent>
                  )}
                </Tabs>
              )}
            </div>
          );
        })()}



        {/* Crawl history */}
        {siteData && siteData.recentCrawls.length > 1 && (
          <div className="rounded-xl border border-border p-5 space-y-3">
            <p className="text-sm font-medium">Crawl history</p>
            <div className="space-y-1">
              {siteData.recentCrawls.map((c, i) => {
                const runNumber = siteData.recentCrawls.length - i;
                const isCurrent = c.id === crawlId;
                const providers = (c as Crawl).providers ?? [];
                return (
                  <a
                    key={c.id}
                    href={`/crawls/${c.id}`}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-muted/60 ${isCurrent ? "bg-muted/40" : "text-muted-foreground"}`}
                  >
                    {/* Run number */}
                    <span className={`w-14 shrink-0 tabular-nums ${isCurrent ? "font-semibold text-foreground" : ""}`}>
                      Run #{runNumber}
                    </span>

                    {/* Provider logos */}
                    <div className="flex items-center gap-0.5 w-20 shrink-0">
                      {providers.map((p) => (
                        <img
                          key={p}
                          src={PROVIDER_META[p]?.logo ?? "/providers/fallback.png"}
                          alt={PROVIDER_META[p]?.label ?? p}
                          className="w-4 h-4 object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ))}
                    </div>

                    {/* Date */}
                    <span className="flex-1 truncate">
                      {isCurrent
                        ? "This crawl"
                        : new Date(c.createdAt || "").toLocaleDateString(undefined, {
                            month: "short", day: "numeric",
                            hour: "2-digit", minute: "2-digit",
                          })}
                    </span>

                    {/* Automated badge */}
                    {(c as Crawl).automated && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        Automated
                      </Badge>
                    )}

                    {/* Status */}
                    <Badge
                      variant={STATUS_VARIANT[c.status] ?? "secondary"}
                      className={`shrink-0 text-[10px] ${c.status === "completed" ? "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400" : ""}`}
                    >
                      {c.status}
                    </Badge>
                  </a>
                );
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
