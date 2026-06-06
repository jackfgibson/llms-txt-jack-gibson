"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";
import { Toggle } from "@/components/ui/toggle";

const FEATURES: Array<{ label: string; href?: string }> = [
  { label: "Respects robots.txt" },
  { label: "Spec-validated output", href: "https://llmstxt.org/#format" },
  { label: "Dynamic crawl configuration" },
];

const ALL_PROVIDERS = ["anthropic", "openai", "fallback"] as const;
type Provider = (typeof ALL_PROVIDERS)[number];

const PROVIDER_META: Record<Provider, { logo: string; label: string }> = {
  anthropic: { logo: "/providers/claude.png", label: "Claude" },
  openai:    { logo: "/providers/openai.png",  label: "GPT" },
  fallback:  { logo: "/providers/fallback.png", label: "Non-LLM" },
};

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([...ALL_PROVIDERS]);

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
        body: JSON.stringify({ url: normalized, providers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push(`/crawls/${data.crawlId}`);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="w-full max-w-lg space-y-10">

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

        {/* Provider toggle */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-xs text-muted-foreground">Generate with</p>
          <div className="flex gap-2">
            {ALL_PROVIDERS.map((p) => (
              <Toggle
                key={p}
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
                  className="w-7 h-7 object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
                <span className="text-[10px] font-medium leading-none">
                  {PROVIDER_META[p].label}
                </span>
              </Toggle>
            ))}
          </div>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="space-y-3">
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
                "Pick at least 1 generation method"
              ) : (
                <>
                  Generate
                  <ArrowRightIcon className="size-3.5" />
                </>
              )}
            </Button>
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
