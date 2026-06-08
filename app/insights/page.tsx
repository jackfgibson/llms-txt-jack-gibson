"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  latest: { crawlId: string; status: string; providers: string[] };
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

const PLACEMENT_COLOR: Record<string, string> = {
  Excellent: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  Great:     "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  Good:      "bg-muted text-muted-foreground",
};

function ModelRow({ result, isWinner, expanded, onToggle }: {
  result: EvalResult;
  isWinner: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const meta = PROVIDER_META[result.provider] ?? { logo: "/providers/fallback.png", label: result.provider };
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isWinner && <span className="text-base leading-none">👑</span>}
          <img
            src={meta.logo}
            alt={meta.label}
            className="w-6 h-6 object-contain shrink-0"
            style={{ imageRendering: "pixelated" }}
          />
          <span className="text-sm font-medium">{meta.label}</span>
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

export default function InsightsPage() {
  const [sites, setSites] = useState<SiteGroup[]>([]);
  const [sitesLoading, setSitesLoading] = useState(true);
  const [selectedSiteId, setSelectedSiteId] = useState<string>("");
  const [insight, setInsight] = useState<Insight | null | undefined>(undefined);
  const [triggering, setTriggering] = useState(false);
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});

  const LLM_PROVIDERS = ["anthropic", "openai", "gemini"];

  // Load all sites, keeping only those whose latest completed crawl used all 3 LLM providers
  useEffect(() => {
    fetch("/api/crawls")
      .then((r) => r.json())
      .then((data: SiteGroup[]) => {
        const eligible = data.filter(
          (s) =>
            s.latest.status === "completed" &&
            LLM_PROVIDERS.every((p) => s.latest.providers?.includes(p)),
        );
        setSites(eligible);
        setSitesLoading(false);
      })
      .catch(() => setSitesLoading(false));
  }, []);

  // Fetch insights when site is selected
  const fetchInsight = useCallback(async (siteId: string) => {
    if (!siteId) return;
    const res = await fetch(`/api/sites/${siteId}/insights`);
    if (!res.ok) return;
    const data: Insight | null = await res.json();
    setInsight(data);
  }, []);

  // Poll while pending or running
  useEffect(() => {
    if (!selectedSiteId) return;
    setInsight(undefined);
    fetchInsight(selectedSiteId);
  }, [selectedSiteId, fetchInsight]);

  useEffect(() => {
    if (insight?.status !== "pending" && insight?.status !== "running") return;
    const timer = setTimeout(() => fetchInsight(selectedSiteId), 2000);
    return () => clearTimeout(timer);
  }, [insight, selectedSiteId, fetchInsight]);

  async function handleGenerate() {
    if (!selectedSiteId) return;
    setTriggering(true);
    try {
      const res = await fetch(`/api/sites/${selectedSiteId}/insights`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to trigger evaluation");
        return;
      }
      setInsight(data);
    } finally {
      setTriggering(false);
    }
  }

  const sortedResults = insight?.evalResults
    ? [...insight.evalResults].sort((a, b) => b.finalScore - a.finalScore)
    : [];

  return (
    <div className="flex flex-1 flex-col items-center px-6 py-10 min-h-screen">
      <div className="w-full max-w-2xl space-y-8">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Model Insights</h1>
          <p className="text-sm text-muted-foreground">
            Compare how Claude, GPT-4o, and Gemini perform on accuracy and structure for a given site.
            Requires a crawl with all 3 LLM providers.
          </p>
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
                <span className={selectedSiteId ? "text-foreground" : "text-muted-foreground"}>
                  {selectedSiteId
                    ? (sites.find((s) => s.siteId === selectedSiteId)?.hostname ?? "— choose a site —")
                    : "Select a site"}
                </span>
                <ChevronsUpDownIcon className="size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {sites.map((s) => (
                  <DropdownMenuItem
                    key={s.siteId}
                    onClick={() => {
                      setSelectedSiteId(s.siteId);
                      setExpandedProviders({});
                    }}
                  >
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
            {insight === undefined && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Checking…
              </div>
            )}

            {insight === null && (
              <div className="space-y-2">
                <Button onClick={handleGenerate} disabled={triggering} className="gap-2">
                  {triggering && <Spinner className="size-4" />}
                  Generate Model Insights
                </Button>
                <p className="text-xs text-muted-foreground">This may take over a minute — the evaluation runs 18 LLM calls across all three providers.</p>
              </div>
            )}

            {(insight?.status === "pending" || insight?.status === "running") && (
              <div className="space-y-1">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Spinner className="size-4" />
                  Evaluating models…
                </div>
                <p className="text-xs text-muted-foreground">This may take over a minute.</p>
              </div>
            )}

            {insight?.status === "failed" && (
              <div className="space-y-3">
                <p className="text-sm text-destructive">Evaluation failed.</p>
                <Button onClick={handleGenerate} disabled={triggering} variant="outline" className="gap-2">
                  {triggering ? <Spinner className="size-4" /> : <RefreshCwIcon className="size-4" />}
                  Retry
                </Button>
              </div>
            )}

            {insight?.status === "completed" && sortedResults.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Results</p>
                  <span className="text-xs text-muted-foreground">Score = accuracy + structure boost</span>
                </div>
                {sortedResults.map((result) => (
                  <ModelRow
                    key={result.provider}
                    result={result}
                    isWinner={result.provider === insight.winner}
                    expanded={!!expandedProviders[result.provider]}
                    onToggle={() =>
                      setExpandedProviders((prev) => ({
                        ...prev,
                        [result.provider]: !prev[result.provider],
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
