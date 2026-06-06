"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Separator } from "@/components/ui/separator";

const FEATURES = [
  "Respects robots.txt",
  "No API key required",
  "Spec-validated output",
  "Up to 50 pages crawled",
];

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
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
            className="w-16 h-16 object-contain"
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
              Crawls your site, curates the key pages, and produces a spec-valid file in seconds.
            </p>
          </div>
        </div>

        {/* Input form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 focus-within:ring-3 focus-within:ring-ring/50 focus-within:border-ring transition-all">
            <GlobeIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              type="url"
              placeholder="https://example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
              disabled={loading}
              className="flex-1 border-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-none h-9 px-1 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={loading || !url}
              className="shrink-0 gap-1.5"
            >
              {loading ? (
                <Spinner className="size-3.5" />
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
            <span key={f} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{f}</span>
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
