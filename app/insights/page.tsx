"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { removePendingInsight } from "@/lib/pending-jobs";
import { toast } from "sonner";
import { ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, DownloadIcon, ExternalLinkIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { FaviconImg } from "@/components/favicon-img";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";

const PROVIDER_META: Record<string, { logo: string; label: string }> = {
  anthropic: { logo: "/providers/claude.png",  label: "Claude Haiku" },
  openai:    { logo: "/providers/openai.png",   label: "GPT-4o mini" },
  gemini:    { logo: "/providers/gemini.png",   label: "Gemini 3 Flash" },
};

interface SiteGroup {
  siteId: string;
  hostname: string;
  slug: string;
  faviconUrl: string | null;
  latest: { crawlId: string; status: string; providers: string[] };
  hasInsights: boolean;
}

interface QADetail {
  question: string;
  correctAnswer: string;
  givenAnswer: string;
  score: number;
  reasoning: string;
}

interface EvalResult {
  id: string;
  provider: string;
  accuracy: number;
  structurePlacement: "Excellent" | "Great" | "Good";
  finalScore: number;
  details: { questionsAnswered: QADetail[]; structurePick: string };
}

interface Insight {
  id: string;
  siteId: string;
  crawlId: string;
  status: "pending" | "running" | "completed" | "failed";
  winner: string | null;
  createdAt: string;
  finishedAt: string | null;
  evalResults: EvalResult[];
}

const PROVIDER_FILENAME: Record<string, string> = {
  anthropic: "claude",
  openai:    "chatgpt",
  gemini:    "gemini",
  fallback:  "deterministic",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending:   "secondary",
  running:   "secondary",
  completed: "outline",
  failed:    "destructive",
};

const PLACEMENT_COLOR: Record<string, string> = {
  Excellent: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  Great:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Good:      "bg-muted text-muted-foreground",
};

function ModelRow({ result, isWinner, expanded, onToggle, siteId, crawlId, hostname }: {
  result: EvalResult;
  isWinner: boolean;
  expanded: boolean;
  onToggle: () => void;
  siteId: string;
  crawlId: string;
  hostname: string;
}) {
  const meta = PROVIDER_META[result.provider] ?? { logo: "/providers/fallback.png", label: result.provider };

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const res = await fetch(`/api/sites/${siteId}/generation?crawlId=${crawlId}&provider=${result.provider}`);
    if (!res.ok) return;
    const text = await res.text();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${PROVIDER_FILENAME[result.provider] ?? result.provider}_llms.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="flex items-center">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 px-4 py-3 flex-1 min-w-0 hover:bg-muted/40 transition-colors text-left"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <img
              src={meta.logo}
              alt={meta.label}
              className="w-6 h-6 object-contain shrink-0"
              style={{ imageRendering: "pixelated" }}
            />
            <span className="text-sm font-medium">{meta.label}</span>
            {isWinner && <span className="text-base leading-none">&#x1F451;</span>}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-xs text-muted-foreground">
              Accuracy <span className="font-semibold text-foreground tabular-nums">{result.accuracy.toFixed(1)}</span>/10
            </span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PLACEMENT_COLOR[result.structurePlacement]}`}>
              {result.structurePlacement}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {result.finalScore.toFixed(1)}
            </span>
            {expanded
              ? <ChevronDownIcon className="size-4 text-muted-foreground" />
              : <ChevronRightIcon className="size-4 text-muted-foreground" />
            }
          </div>
        </button>
        <button
          onClick={handleDownload}
          className="flex items-center justify-center px-3 py-3 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 border-l border-border self-stretch"
          title={`Download ${meta.label} llms.txt`}
        >
          <DownloadIcon className="size-5" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/20">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Q&A Scores</p>
            <div className="space-y-3">
              {result.details.questionsAnswered.map((qa, i) => (
                <div key={i} className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-foreground flex-1">{qa.question}</p>
                    <span className="text-xs font-semibold tabular-nums shrink-0">{qa.score.toFixed(1)}/2.5</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Given:</span> {qa.givenAnswer}
                  </p>
                  <p className="text-xs text-muted-foreground italic">{qa.reasoning}</p>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">Structure pick</p>
            <p className="text-xs text-foreground">
              This model voted{" "}
              <span className="font-semibold">
                {PROVIDER_META[result.details.structurePick]?.label ?? result.details.structurePick}
              </span>{" "}
              as having better-structured llms.txt.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function InsightsPageInner() {
  const searchParams = useSearchParams();
  const preselectedSiteId = searchParams.get("siteId") ?? "";

  const [sites, setSites] = useState<SiteGroup[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string>(preselectedSiteId);
  // undefined = loading, [] = none exist
  const [insights, setInsights] = useState<Insight[] | undefined>(undefined);
  const [activeInsightId, setActiveInsightId] = useState<string | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const router = useRouter();
  const LLM_PROVIDERS = ["anthropic", "openai", "gemini"];

  // Derived: the insight currently being displayed
  const activeInsight = insights?.find((i) => i.id === activeInsightId) ?? insights?.[0] ?? null;

  // Load all sites, keeping only those whose latest completed crawl used all 3 LLM providers
  useEffect(() => {
    fetch("/api/crawls")
      .then((r) => r.json())
      .then((data: SiteGroup[]) => {
        const eligible = data.filter(
          (s) =>
            s.hasInsights ||
            (s.latest.status === "completed" &&
              LLM_PROVIDERS.every((p) => s.latest.providers?.includes(p))),
        );
        setSites(eligible);
        setSitesLoading(false);
      })
      .catch(() => setSitesLoading(false));
  }, []);

  // Fetch all insights for selected site
  const fetchInsights = useCallback(async (siteId: string) => {
    if (!siteId) return;
    const res = await fetch(`/api/sites/${siteId}/insights?all=true`);
    if (!res.ok) return;
    const data: Insight[] = await res.json();
    setInsights(data);
    // If the most recent insight has finished, remove from global pending queue
    if (data[0]?.status === "completed" || data[0]?.status === "failed") {
      removePendingInsight(siteId);
    }
  }, []);

  // Reset and reload when site changes
  useEffect(() => {
    if (!selectedSiteId) return;
    setInsights(undefined);
    setActiveInsightId(null);
    setExpandedProviders({});
    fetchInsights(selectedSiteId);
  }, [selectedSiteId, fetchInsights]);

  // Poll while the most recent insight is still in-progress
  useEffect(() => {
    if (!insights?.length) return;
    const latest = insights[0];
    if (latest.status !== "pending" && latest.status !== "running") return;
    const timer = setTimeout(() => fetchInsights(selectedSiteId), 2000);
    return () => clearTimeout(timer);
  }, [insights, selectedSiteId, fetchInsights]);

  async function handleGenerate() {
    if (!selectedSiteId) return;
    setTriggering(true);
    try {
      const res = await fetch(`/api/sites/${selectedSiteId}/insights`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Failed to trigger evaluation");
        return;
      }
      if (res.status === 200) {
        // Server returned an existing completed insight — no new crawl to evaluate
        toast("Already up to date", {
          description: "Insights are current for this site's most recent crawl.",
        });
        return;
      }
      // 202 — new insight queued
      await fetchInsights(selectedSiteId);
      setActiveInsightId(null); // reset to show the newest pending entry
    } finally {
      setTriggering(false);
    }
  }

  const sortedResults = activeInsight?.evalResults
    ? [...activeInsight.evalResults].sort((a, b) => b.finalScore - a.finalScore)
    : [];

  const selectedSite = sites.find((s) => s.siteId === selectedSiteId);
  const hostname = selectedSite?.hostname ?? "site";
  // Site is eligible for new insight generation if its latest crawl used all 3 providers
  const isSelectedSiteEligible =
    selectedSite != null &&
    selectedSite.latest.status === "completed" &&
    LLM_PROVIDERS.every((p) => selectedSite.latest.providers?.includes(p));

  // Show "Generate for Most Recent Crawl" only when eligible AND the latest crawl has no insight yet
  const hasNewerCrawl =
    isSelectedSiteEligible &&
    insights !== undefined &&
    insights.length > 0 &&
    insights[0].crawlId !== selectedSite!.latest.crawlId;

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10 min-h-screen">

      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Model Insights</h1>
            <p className="text-sm text-muted-foreground">
              Compare how Claude, GPT-4o, and Gemini perform on accuracy and structure for a given site.
              Requires latest crawl performed with all 3 LLM providers.
            </p>
          </div>
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 text-left hover:bg-muted/50 transition-colors [&[data-state=open]>svg]:rotate-180">
              <span className="text-xs font-medium text-foreground">How it works</span>
              <ChevronDownIcon className="size-3.5 text-muted-foreground transition-transform duration-200" />
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-none">
              <div className="rounded-b-lg border border-t-0 border-border bg-muted/20 px-4 py-3 space-y-2">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Each model generates its own <code className="font-mono bg-muted px-1 rounded">llms.txt</code> from the crawled site.
                  Then each model is tested on the other two models&apos; documents — answering 4 factual questions worth 2.5 pts each (10 pts total).
                  Models also vote on which competitor&apos;s output has the best structure.
                  The final score is <span className="text-foreground font-medium">Accuracy + Structure Boost</span>.
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5">
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">Excellent</span>
                    <span className="text-muted-foreground">Most structure votes — +0.8 pts</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Great</span>
                    <span className="text-muted-foreground">Second most votes — +0.4 pts</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">Good</span>
                    <span className="text-muted-foreground">Fewest structure votes — +0 pts</span>
                  </span>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Site selector */}
        <div className="space-y-2">
          {sitesLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Loading sites…
            </div>
          ) : sites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No eligible sites found. Submit a URL with all 3 LLM providers selected.</p>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent transition-colors">
                <span className={`flex items-center gap-2 ${selectedSiteId ? "text-foreground" : "text-muted-foreground"}`}>
                  {(() => {
                    const selected = sites.find((s) => s.siteId === selectedSiteId);
                    return selected ? (
                      <>
                        <FaviconImg src={selected.faviconUrl} />
                        {selected.hostname}
                      </>
                    ) : "Select a site";
                  })()}
                </span>
                <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {sites.map((s) => (
                  <DropdownMenuItem
                    key={s.siteId}
                    onClick={() => setSelectedSiteId(s.siteId)}
                    className="flex items-center gap-2"
                  >
                    <FaviconImg src={s.faviconUrl} />
                    {s.hostname}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Status / action */}
        {selectedSiteId && (
          <div className="space-y-6">
            {/* Loading */}
            {insights === undefined && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Checking…
              </div>
            )}

            {/* No insights yet — only show generate button if the site is eligible */}
            {insights?.length === 0 && isSelectedSiteEligible && (
              <div className="space-y-2">
                <Button onClick={handleGenerate} disabled={triggering} className="gap-2">
                  {triggering && <Spinner className="size-4" />}
                  Generate Model Insights
                </Button>
                <p className="text-xs text-muted-foreground">This may take up to 30 seconds to complete.</p>
              </div>
            )}

            {/* Active insight states */}
            {insights && insights.length > 0 && activeInsight && (
              <>
                {(activeInsight.status === "pending" || activeInsight.status === "running") && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <Spinner className="size-4" />
                      Evaluating models…
                    </div>
                    <p className="text-xs text-muted-foreground">This may take up to 30 seconds.</p>
                  </div>
                )}

                {activeInsight.status === "failed" && (
                  <div className="space-y-3">
                    <p className="text-sm text-destructive">Evaluation failed.</p>
                    <Button onClick={handleGenerate} disabled={triggering} variant="outline" className="gap-2">
                      {triggering ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
                      Retry
                    </Button>
                  </div>
                )}

                {activeInsight.status === "completed" && sortedResults.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Results</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/crawls/${activeInsight.crawlId}`)}
                        className="gap-1.5"
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        View Associated Crawl
                      </Button>
                    </div>
                    {sortedResults.map((result) => (
                      <ModelRow
                        key={result.provider}
                        result={result}
                        isWinner={result.provider === activeInsight.winner}
                        expanded={!!expandedProviders[result.provider]}
                        onToggle={() =>
                          setExpandedProviders((prev) => ({
                            ...prev,
                            [result.provider]: !prev[result.provider],
                          }))
                        }
                        siteId={activeInsight.siteId}
                        crawlId={activeInsight.crawlId}
                        hostname={hostname}
                      />
                    ))}
                  </div>
                )}

                {/* Generate a fresh run — only when a newer crawl exists without an insight */}
                {hasNewerCrawl && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={triggering}
                    className="gap-1.5 self-start"
                  >
                    {triggering ? <Spinner className="size-3.5" /> : <SparklesIcon className="size-3.5" />}
                    Generate Insights for Most Recent Crawl
                  </Button>
                )}

                {/* Insights history — shown when there are multiple runs */}
                {insights.length > 1 && (
                  <div className="rounded-xl border border-border p-5 space-y-3">
                    <p className="text-sm font-medium">Insights history</p>
                    <div className="space-y-1">
                      {insights.map((ins, i) => {
                        const runNumber = insights.length - i;
                        const isCurrent = ins.id === (activeInsightId ?? insights[0].id);
                        const winnerMeta = ins.winner ? PROVIDER_META[ins.winner] : null;
                        const winnerScore = ins.evalResults
                          .find((r) => r.provider === ins.winner)
                          ?.finalScore;
                        const date = ins.finishedAt ?? ins.createdAt;
                        return (
                          <button
                            key={ins.id}
                            onClick={() => {
                              setActiveInsightId(ins.id);
                              setExpandedProviders({});
                            }}
                            className={`w-full flex items-center gap-3 rounded-lg px-3 py-2 text-xs transition-colors hover:bg-muted/60 text-left ${isCurrent ? "bg-muted/40" : "text-muted-foreground"}`}
                          >
                            <span className={`w-14 shrink-0 tabular-nums ${isCurrent ? "font-semibold text-foreground" : ""}`}>
                              Run #{runNumber}
                            </span>
                            <span className="flex-1 truncate">
                              {isCurrent && i === 0
                                ? "This run"
                                : new Date(date).toLocaleDateString(undefined, {
                                    month: "short", day: "numeric",
                                    hour: "2-digit", minute: "2-digit",
                                  })}
                            </span>
                            {ins.status === "completed" && winnerMeta ? (
                              <span className="flex items-center gap-1 shrink-0">
                                <img
                                  src={winnerMeta.logo}
                                  alt={winnerMeta.label}
                                  className="w-4 h-4 object-contain"
                                  style={{ imageRendering: "pixelated" }}
                                />
                                <span className={isCurrent ? "text-foreground" : ""}>{winnerMeta.label}</span>
                                {winnerScore != null && (
                                  <span className="tabular-nums font-semibold text-foreground ml-1">
                                    {winnerScore.toFixed(1)}
                                  </span>
                                )}
                              </span>
                            ) : (
                              <Badge
                                variant={STATUS_VARIANT[ins.status] ?? "secondary"}
                                className="shrink-0 text-[10px]"
                              >
                                {ins.status}
                              </Badge>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsPageInner />
    </Suspense>
  );
}
