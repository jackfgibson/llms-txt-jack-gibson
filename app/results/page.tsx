"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowRightIcon, DownloadIcon, MoreHorizontalIcon } from "lucide-react";
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
  gemini:    "Gemini 2.0 Flash",
  fallback:  "Non-LLM",
};

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending:    "secondary",
  crawling:   "secondary",
  generating: "secondary",
  completed:  "outline",
  failed:     "destructive",
};

interface CrawlEntry {
  crawlId: string;
  siteId: string;
  slug: string;
  hostname: string;
  providers: string[];
  status: string;
  submittedAt: string;
}

interface Generation {
  id: string;
  content: string;
  provider: string;
  mode: string;
  version: number;
}

async function fetchResults(): Promise<CrawlEntry[]> {
  try {
    const res = await fetch("/api/crawls");
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchGenerations(siteId: string): Promise<Generation[]> {
  try {
    const res = await fetch(`/api/sites/${siteId}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.latestGenerations ?? [];
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

async function downloadSingle(siteId: string, provider: string, hostname: string) {
  const gens = await fetchGenerations(siteId);
  const gen = gens.find((g) => g.provider === provider);
  if (!gen) return;
  const label = PROVIDER_MODEL[provider] ?? provider;
  triggerDownload(`llms-${hostname}-${label}.txt`, gen.content);
}

async function downloadAll(siteId: string, hostname: string) {
  const gens = await fetchGenerations(siteId);
  if (gens.length === 0) return;

  if (gens.length === 1) {
    const label = PROVIDER_MODEL[gens[0].provider] ?? gens[0].provider;
    triggerDownload(`llms-${hostname}-${label}.txt`, gens[0].content);
    return;
  }

  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const gen of gens) {
    const label = PROVIDER_MODEL[gen.provider] ?? gen.provider;
    zip.file(`llms-${label}.txt`, gen.content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `llms-${hostname}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

function ResultCard({ entry }: { entry: CrawlEntry }) {
  const isRunning =
    entry.status !== "completed" && entry.status !== "failed";
  const isCompleted = entry.status === "completed";
  const [downloading, setDownloading] = useState(false);

  async function handleDownloadSingle(provider: string) {
    setDownloading(true);
    try {
      await downloadSingle(entry.siteId, provider, entry.hostname);
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadAll() {
    setDownloading(true);
    try {
      await downloadAll(entry.siteId, entry.hostname);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3 hover:bg-muted/40 transition-colors">
      {/* Left: info */}
      <Link href={`/crawls/${entry.crawlId}`} className="flex items-center gap-3 flex-1 min-w-0">
        {isRunning && (
          <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{entry.hostname}</p>
          <div className="flex items-center gap-1 mt-0.5">
            {entry.providers.map((p) => (
              <img
                key={p}
                src={PROVIDER_META[p]?.logo ?? "/providers/fallback.png"}
                alt={PROVIDER_META[p]?.label ?? p}
                className="w-5 h-5 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ))}
          </div>
        </div>
      </Link>

      {/* Right: badge + actions */}
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <Badge
          variant={STATUS_VARIANT[entry.status] ?? "secondary"}
          className={entry.status === "completed" ? "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400" : undefined}
        >
          {entry.status}
        </Badge>

        {isCompleted && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={downloading}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {downloading ? (
                <Spinner className="size-3.5" />
              ) : (
                <MoreHorizontalIcon className="size-4" />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Download</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {entry.providers.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    onClick={() => handleDownloadSingle(p)}
                    className="gap-2"
                  >
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
              {entry.providers.length > 1 && (
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

        <Link href={`/crawls/${entry.crawlId}`}>
          <ArrowRightIcon className="size-3.5 text-muted-foreground" />
        </Link>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [results, setResults] = useState<CrawlEntry[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    fetchResults().then(setResults);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const active = results.filter(
      (r) => r.status !== "completed" && r.status !== "failed",
    );
    if (active.length === 0) return;

    const timer = setTimeout(() => {
      fetchResults().then(setResults);
    }, 2000);

    return () => clearTimeout(timer);
  }, [results, mounted]);

  return (
    <div className="flex flex-1 flex-col px-6 py-10">
      <div className="w-full max-w-2xl mx-auto space-y-6">

        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Results</h1>
          <p className="text-sm text-muted-foreground mt-1">
            All generations, newest first.
          </p>
        </div>

        {!mounted ? null : results.length === 0 ? (
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
            {results.map((entry) => (
              <ResultCard key={entry.crawlId} entry={entry} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}
