"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Toggle } from "@/components/ui/toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const FEATURES: Array<{ label: string; href?: string }> = [
  { label: "Respects robots.txt" },
  { label: "Spec-validated output", href: "https://llmstxt.org/#format" },
  { label: "Dynamic crawl configuration" },
];

const ALL_PROVIDERS = ["anthropic", "openai", "gemini", "fallback"] as const;
type Provider = (typeof ALL_PROVIDERS)[number];

const PROVIDER_META: Record<Provider, { logo: string; label: string; model: string }> = {
  anthropic: { logo: "/providers/claude.png",   label: "Claude",   model: "claude-haiku-4-5-20251001" },
  openai:    { logo: "/providers/openai.png",    label: "GPT",      model: "gpt-4o-mini" },
  gemini:    { logo: "/providers/gemini.png",    label: "Gemini",   model: "gemini-2.0-flash" },
  fallback:  { logo: "/providers/fallback.png",  label: "Non-LLM",  model: "deterministic flow" },
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([...ALL_PROVIDERS]);
  const [maxPages, setMaxPages] = useState(25);
  const [maxDepth, setMaxDepth] = useState(3);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (providers.length === 0) {
      setError("Select at least one provider");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const normalized =
        url.startsWith("http://") || url.startsWith("https://")
          ? url
          : `https://${url}`;

      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: normalized, providers, maxPages, maxDepth }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }

      setUrl("");
      toast("Generation kicked off!", {
        description: "Your llms.txt is being generated in the background.",
        action: {
          label: "View results →",
          onClick: () => router.push("/results"),
        },
        duration: 8000,
      });
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg space-y-8">

        {/* Wordmark */}
        <div className="flex flex-col items-center space-y-3 text-center">
          <img
            src="/logo.png"
            alt="Crawl Atlas logo"
            className="w-28 h-28 object-contain"
            style={{ imageRendering: "pixelated" }}
          />
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Crawl Atlas
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Generate <code className="font-mono text-2xl">llms.txt</code> for any site
            </h1>
            <p className="text-sm text-muted-foreground">
              Crawls any site, curates the key pages, and produces a spec-valid file in seconds.
            </p>
          </div>
        </div>

        {/* Input + options form */}
        <form onSubmit={handleSubmit} className="space-y-3">

          {/* URL row */}
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 focus-within:ring-3 focus-within:ring-ring/50 focus-within:border-ring transition-all">
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              type="text"
              placeholder="example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-none h-9 px-1 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={loading || !url || providers.length === 0}
              className="shrink-0 gap-1.5"
            >
              {loading ? (
                <Spinner className="size-3.5" />
              ) : providers.length === 0 ? (
                "Pick at least 1 method"
              ) : (
                <>
                  Generate
                  <ArrowRightIcon className="size-3.5" />
                </>
              )}
            </Button>
          </div>

          {/* Options panel */}
          <div className="rounded-xl border border-border bg-muted/20 px-5 py-4 space-y-4">

            {/* Provider toggles */}
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-muted-foreground">Generate with</p>
              <div className="flex gap-2">
                {ALL_PROVIDERS.map((p) => (
                  <Tooltip key={p}>
                    <TooltipTrigger render={<span className="inline-flex" />}>
                      <Toggle
                        pressed={providers.includes(p)}
                        onPressedChange={(pressed) =>
                          setProviders((prev) =>
                            pressed ? [...prev, p] : prev.filter((x) => x !== p),
                          )
                        }
                        aria-label={PROVIDER_META[p].label}
                        variant="outline"
                        className="flex flex-col items-center gap-1.5 h-auto px-5 py-2.5 rounded-xl aria-pressed:bg-muted aria-pressed:border-foreground/20"
                      >
                        <img
                          src={PROVIDER_META[p].logo}
                          alt={PROVIDER_META[p].label}
                          className="w-10 h-10 object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                        <span className="text-[10px] font-medium leading-none">
                          {PROVIDER_META[p].label}
                        </span>
                      </Toggle>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                      <p className="font-mono text-xs">{PROVIDER_META[p].model}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            <Separator />

            {/* Crawl options */}
            <div className="flex items-center justify-center gap-8">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="max-pages"
                  className="text-xs text-muted-foreground whitespace-nowrap"
                >
                  Max pages
                </label>
                <Input
                  id="max-pages"
                  type="number"
                  min={5}
                  max={50}
                  value={maxPages}
                  onChange={(e) =>
                    setMaxPages(
                      Math.min(50, Math.max(5, Number(e.target.value) || 5)),
                    )
                  }
                  disabled={loading}
                  className="w-20 h-8 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="max-depth"
                  className="text-xs text-muted-foreground whitespace-nowrap"
                >
                  Max depth
                </label>
                <Input
                  id="max-depth"
                  type="number"
                  min={1}
                  max={3}
                  value={maxDepth}
                  onChange={(e) =>
                    setMaxDepth(
                      Math.min(3, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  disabled={loading}
                  className="w-20 h-8 text-sm text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <p className="text-xs text-destructive text-center">{error}</p>
          )}
        </form>

        {/* Feature list */}
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {FEATURES.map((f, i) => (
            <span key={f.label} className="flex items-center gap-3">
              {f.href ? (
                <a
                  href={f.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  {f.label}
                </a>
              ) : (
                <span className="text-xs text-muted-foreground">{f.label}</span>
              )}
              {i < FEATURES.length - 1 && (
                <Separator orientation="vertical" className="h-3" />
              )}
            </span>
          ))}
        </div>

      </div>
    </div>
  );
}
