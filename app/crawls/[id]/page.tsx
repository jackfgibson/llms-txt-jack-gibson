"use client";

import { useEffect, useState } from "react";
import { use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, CopyIcon, DownloadIcon, ExternalLinkIcon, MoreHorizontalIcon, RefreshCwIcon, XIcon } from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  providers: string[] | null;
  createdAt: string;
  finishedAt: string | null;
  generations: Generation[]; // crawl-specific, always present after completion
}

interface Generation {
  id: string;
  content: string;
  version: number;
  mode: string;
  provider: string;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    score: number;
  } | null;
}

interface SiteData {
  site: { id: string; url: string; slug: string };
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
  gemini:    "Gemini 2.0 Flash",
  fallback:  "Non-LLM",
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

  function copy() {
    navigator.clipboard.writeText(generation.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const label = PROVIDER_MODEL[generation.provider] ?? generation.provider;
    const filename = hostname
      ? `llms-${hostname}-v${generation.version}-${label}.txt`
      : `llms-v${generation.version}-${label}.txt`;
    const blob = new Blob([generation.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Validation */}
      {generation.validation && (
        <div className="rounded-xl border border-border p-6">
          <div className="flex items-start gap-6">
            <ScoreRing score={generation.validation.score} />
            <div className="flex-1 space-y-3 pt-1">
              <div>
                <p className="text-sm font-medium">Spec validation</p>
                <p className="text-xs text-muted-foreground">
                  Model: <span className="font-mono">{PROVIDER_MODEL[generation.provider] ?? generation.provider}</span>
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
                <p key={w} className="text-xs text-muted-foreground">
                  ⚠ {w}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/40">
          <span className="text-xs font-mono text-muted-foreground">
            llms.txt
            {!isLatest && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">(historical — not the live version)</span>
            )}
          </span>
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
        <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed p-5 overflow-auto max-h-[60vh] bg-background">
          {generation.content}
        </pre>
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
  const [rechecking, setRechecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let siteDataLoaded = false;

    async function poll() {
      try {
        const res = await fetch(`/api/crawls/${crawlId}`);
        if (!res.ok) return;
        const data: Crawl = await res.json();
        setCrawl(data);

        // Fetch site data on the first poll so history is visible immediately,
        // even while the crawl is still pending/running.
        if (!siteDataLoaded) {
          siteDataLoaded = true;
          const siteRes = await fetch(`/api/sites/${data.siteId}`);
          if (siteRes.ok) setSiteData(await siteRes.json());
        }

        if (data.status === "completed" || data.status === "failed") {
          // Re-fetch site data on completion to pick up new generation
          const siteRes = await fetch(`/api/sites/${data.siteId}`);
          if (siteRes.ok) setSiteData(await siteRes.json());
          // Fetch change_event for this crawl
          const evRes = await fetch(`/api/crawls/${crawlId}/change-event`);
          if (evRes.ok) {
            const ev = await evRes.json();
            setChangeEvent(ev ?? null);
          } else {
            setChangeEvent(null);
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

  async function handleRecheck() {
    if (!crawl || !siteData) return;
    setRechecking(true);
    try {
      const res = await fetch(`/api/sites/${crawl.siteId}/crawl`, { method: "POST" });
      if (!res.ok) {
        toast.error("Re-check failed", { description: "Could not start a new crawl." });
        return;
      }
      const { crawlId: newId } = await res.json();
      toast("Re-check started!", {
        description: "A new crawl is running. Redirecting…",
        duration: 4000,
      });
      router.push(`/crawls/${newId}`);
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setRechecking(false);
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
    const label = PROVIDER_MODEL[provider] ?? provider;
    const name = hostname ?? "site";
    triggerDownload(`llms-${name}-v${gen.version}-${label}.txt`, gen.content);
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
        const label = PROVIDER_MODEL[gen.provider] ?? gen.provider;
        zip.file(`llms-${label}.txt`, gen.content);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `llms-${name}-v${generations[0]?.version ?? 1}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "fallback"];
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
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="size-3" />
          New generation
        </a>

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            {hostname ? (
              <h1 className="text-2xl font-semibold tracking-tight">{hostname}</h1>
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
              {crawl?.stats?.sitemapUsed === 1 && (
                <span className="text-xs text-muted-foreground">via sitemap</span>
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

              <Button
                size="sm"
                variant="outline"
                onClick={handleRecheck}
                disabled={rechecking}
                className="gap-1.5"
              >
                {rechecking ? <Spinner className="size-3.5" /> : <RefreshCwIcon className="size-3.5" />}
                Re-check now
              </Button>
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

            {crawl?.stats?.maxPages != null && (
              <>
                <Separator />
                <div className="grid grid-cols-2 gap-4">
                  {(
                    [
                      ["Max pages", crawl.stats.maxPages],
                      ["Max depth", crawl.stats.maxDepth],
                    ] as [string, number | undefined][]
                  ).map(([label, val]) => (
                    <div key={label} className="space-y-0.5">
                      <p className="text-lg font-semibold tabular-nums">{val ?? "—"}</p>
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

        {/* Results — one tab per provider */}
        {generations.length > 0 && (
          <Tabs defaultValue={defaultTab}>
            <TabsList className="mb-4">
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

        {/* Stats row after completion */}
        {crawl?.status === "completed" && crawl.stats != null && (
          <div className="grid grid-cols-2 gap-4 rounded-xl border border-border p-5">
            {(
              [
                ["Max pages", crawl.stats.maxPages],
                ["Max depth", crawl.stats.maxDepth],
              ] as [string, number | undefined][]
            ).map(([label, val]) => (
              <div key={label} className="space-y-0.5">
                <p className="text-lg font-semibold tabular-nums">{val ?? "—"}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Diff panel — only when change_event exists (recrawl) */}
        {changeEvent && (
          <div className="rounded-xl border border-border p-5 space-y-3">
            <p className="text-sm font-medium">Changes since last crawl</p>
            {changeEvent.diff && (
              changeEvent.diff.added.length === 0 &&
              changeEvent.diff.removed.length === 0 &&
              changeEvent.diff.changed.length === 0
            ) ? (
              <p className="text-xs text-muted-foreground">No content changes detected.</p>
            ) : (
              <div className="space-y-2 text-xs">
                {changeEvent.diff?.added.length ? (
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400 mb-1">
                      +{changeEvent.diff.added.length} added
                    </p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {changeEvent.diff.added.slice(0, 5).map((u) => (
                        <li key={u} className="truncate font-mono">{u}</li>
                      ))}
                      {changeEvent.diff.added.length > 5 && (
                        <li className="text-muted-foreground">+{changeEvent.diff.added.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                ) : null}
                {changeEvent.diff?.removed.length ? (
                  <div>
                    <p className="font-medium text-destructive mb-1">
                      −{changeEvent.diff.removed.length} removed
                    </p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {changeEvent.diff.removed.slice(0, 5).map((u) => (
                        <li key={u} className="truncate font-mono">{u}</li>
                      ))}
                      {changeEvent.diff.removed.length > 5 && (
                        <li className="text-muted-foreground">+{changeEvent.diff.removed.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                ) : null}
                {changeEvent.diff?.changed.length ? (
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
                      ~{changeEvent.diff.changed.length} changed
                    </p>
                    <ul className="space-y-0.5 text-muted-foreground">
                      {changeEvent.diff.changed.slice(0, 5).map((u) => (
                        <li key={u} className="truncate font-mono">{u}</li>
                      ))}
                      {changeEvent.diff.changed.length > 5 && (
                        <li className="text-muted-foreground">+{changeEvent.diff.changed.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}



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
