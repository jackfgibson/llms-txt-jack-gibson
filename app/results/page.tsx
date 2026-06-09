"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRightIcon, DownloadIcon, MoreHorizontalIcon } from "lucide-react";
import { FaviconImg } from "@/components/favicon-img";
import { Badge } from "@/components/ui/badge";
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending:    "secondary",
  crawling:   "secondary",
  generating: "secondary",
  completed:  "outline",
  failed:     "destructive",
};

interface CrawlRun {
  crawlId: string;
  status: string;
  providers: string[];
  submittedAt: string;
  automated: boolean;
}

interface SiteGroup {
  siteId: string;
  hostname: string;
  slug: string;
  faviconUrl: string | null;
  latest: CrawlRun;
  previousRuns: CrawlRun[];
}

interface Generation {
  id: string;
  content: string;
  provider: string;
  mode: string;
  version: number;
}

async function fetchGroups(): Promise<SiteGroup[]> {
  try {
    const res = await fetch("/api/crawls");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchGenerationsForCrawl(crawlId: string): Promise<Generation[]> {
  try {
    const res = await fetch(`/api/crawls/${crawlId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.generations ?? [];
  } catch {
    return [];
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

async function downloadSingle(crawlId: string, provider: string, _hostname: string) {
  const gens = await fetchGenerationsForCrawl(crawlId);
  const gen = gens.find((g) => g.provider === provider);
  if (!gen) return;
  triggerDownload(`${PROVIDER_FILENAME[provider] ?? provider}_llms.txt`, gen.content);
}

async function downloadAll(crawlId: string, hostname: string) {
  const gens = await fetchGenerationsForCrawl(crawlId);
  if (gens.length === 0) return;
  if (gens.length === 1) {
    triggerDownload(`${PROVIDER_FILENAME[gens[0].provider] ?? gens[0].provider}_llms.txt`, gens[0].content);
    return;
  }
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const gen of gens) {
    zip.file(`${PROVIDER_FILENAME[gen.provider] ?? gen.provider}_llms.txt`, gen.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${hostname}_llms_txt.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

const PROVIDER_ORDER = ["anthropic", "openai", "gemini", "fallback"];

function SiteCard({ group }: { group: SiteGroup }) {
  const { latest, hostname, previousRuns, faviconUrl } = group;
  const totalRuns = previousRuns.length + 1;
  const isRunning = latest.status !== "completed" && latest.status !== "failed";
  const isCompleted = latest.status === "completed";

  // All providers ever used across every run, in canonical order, deduplicated
  const allTimeProviders = PROVIDER_ORDER.filter((p) =>
    latest.providers.includes(p) ||
    previousRuns.some((r) => r.providers.includes(p)),
  );
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadSingle(provider: string) {
    setDownloading(true);
    try { await downloadSingle(latest.crawlId, provider, hostname); }
    finally { setDownloading(false); }
  }

  async function handleDownloadAll() {
    setDownloading(true);
    try { await downloadAll(latest.crawlId, hostname); }
    finally { setDownloading(false); }
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3 hover:bg-muted/40 transition-colors">
      {/* Left: hostname + all-time logos + run count / current-run logos */}
      <Link href={`/crawls/${latest.crawlId}`} className="flex items-center gap-3 flex-1 min-w-0">
        {isRunning && <Spinner className="size-3.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          {/* Row 1: favicon · hostname · all-time provider logos · run count */}
          <div className="flex items-center gap-2 min-w-0">
            <FaviconImg src={faviconUrl} />
            <p className="text-sm font-medium truncate shrink min-w-0">{hostname}</p>
            <div className="flex items-center gap-1 shrink-0">
              {allTimeProviders.map((p) => (
                <img
                  key={p}
                  src={PROVIDER_META[p]?.logo ?? "/providers/fallback.png"}
                  alt={PROVIDER_META[p]?.label ?? p}
                  className="w-6 h-6 object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
              ))}
            </div>
            {totalRuns > 1 && (
              <span className="text-[10px] text-muted-foreground shrink-0">{totalRuns} runs</span>
            )}
          </div>
        </div>
      </Link>

      {/* Right: latest-run logos + status badge + download + arrow */}
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <div className="flex items-center gap-1">
          {latest.providers.map((p) => (
            <img
              key={p}
              src={PROVIDER_META[p]?.logo ?? "/providers/fallback.png"}
              alt={PROVIDER_META[p]?.label ?? p}
              className="w-4 h-4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ))}
        </div>
        {latest.automated && (
          <Badge variant="secondary" className="text-[10px]">
            Automated
          </Badge>
        )}
        <Badge
          variant={STATUS_VARIANT[latest.status] ?? "secondary"}
          className={latest.status === "completed" ? "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400" : undefined}
        >
          {latest.status}
        </Badge>

        {isCompleted && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={downloading}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {downloading ? <Spinner className="size-3.5" /> : <MoreHorizontalIcon className="size-4" />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-72">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Download</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {latest.providers.map((p) => (
                  <DropdownMenuItem key={p} onClick={() => handleDownloadSingle(p)} className="gap-2">
                    <DownloadIcon className="size-3.5" />
                    <img
                      src={PROVIDER_META[p]?.logo ?? "/providers/fallback.png"}
                      alt=""
                      className="w-5 h-5 object-contain"
                      style={{ imageRendering: "pixelated" }}
                    />
                    {PROVIDER_MODEL[p] ?? p} — llms.txt
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              {latest.providers.length > 1 && (
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

        <Link href={`/crawls/${latest.crawlId}`}>
          <ArrowRightIcon className="size-3.5 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [groups, setGroups] = useState<SiteGroup[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchGroups().then(setGroups);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const hasActive = groups.some(
      (g) => g.latest.status !== "completed" && g.latest.status !== "failed",
    );
    if (!hasActive) return;

    const timer = setTimeout(() => {
      fetchGroups().then(setGroups);
    }, 2000);

    return () => clearTimeout(timer);
  }, [groups, mounted]);

  return (
    <div className="flex flex-1 flex-col px-6 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All generations, newest first. Click a card to see run history and generated files. Some sites may take a minute or longer to crawl.
          </p>
        </div>

        {!mounted ? null : groups.length === 0 ? (
          <div className="rounded-xl border border-border px-6 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No generations yet.{" "}
              <Link href="/" className="underline underline-offset-2 hover:text-foreground transition-colors">
                Generate one →
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.map((group) => (
              <SiteCard key={group.siteId} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
