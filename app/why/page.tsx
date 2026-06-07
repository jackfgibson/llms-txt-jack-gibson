import { BotIcon, SearchIcon, QuoteIcon, ShieldCheckIcon } from "lucide-react";

const REASONS = [
  {
    icon: BotIcon,
    title: "AI agents navigate your site like a map",
    body: "LLM-powered agents, from ChatGPT browsing to autonomous coding assistants, need a machine-readable index to understand what a site offers without crawling every page. An llms.txt file is exactly that: a curated, structured table of contents that tells any AI system where to look and what it will find.",
  },
  {
    icon: SearchIcon,
    title: "Get cited more often in AI responses",
    body: "When an AI answers a question about your industry, it draws on the sources it can reliably understand. Sites with a clear, well-structured llms.txt signal their content hierarchy clearly, making it far more likely that the model treats your pages as authoritative and surfaces your brand in its answers.",
  },
  {
    icon: QuoteIcon,
    title: "AI talks about your company more accurately",
    body: "Without an llms.txt, a model guesses at your product from scattered page text. With one, you hand it a concise summary of every key page: your pricing, your API docs, your blog. Grounded in real content. The result: fewer hallucinations, fewer outdated facts, and answers that actually reflect what you do.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Built on an open, emerging standard",
    body: "The llms.txt format (llmstxt.org) is gaining adoption across developer tools, SaaS platforms, and documentation sites. Adding it now puts you ahead of the curve, the same way early adopters of sitemap.xml and structured data gained durable SEO advantages before they became table stakes.",
  },
];

export default function WhyPage() {
  return (
    <div className="flex flex-1 flex-col items-center px-6 py-14 min-h-screen">
      <div className="w-full max-w-2xl space-y-12">

        {/* Hero */}
        <div className="space-y-4">
          <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Why do you need an llms.txt?
          </p>
          <h1 className="text-3xl font-semibold tracking-tight leading-snug">
            Help AI navigate your site, and enable it to tell the truth about you.
          </h1>
          <p className="text-base text-muted-foreground leading-relaxed">
            We&apos;re entering an era where AI agents browse the web, answer questions, and make decisions on behalf of users. How well those agents understand your company determines whether they recommend you, cite you accurately, or ignore you entirely.
          </p>
        </div>

        {/* Reason cards */}
        <div className="space-y-6">
          {REASONS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-5 rounded-xl border border-border p-6">
              <div className="shrink-0 mt-0.5">
                <div className="flex size-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-4 text-foreground" />
                </div>
              </div>
              <div className="space-y-1.5">
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What's in the file */}
        <div className="rounded-xl border border-border p-6 space-y-4">
          <p className="text-sm font-semibold">What an llms.txt file looks like</p>
          <pre className="text-xs font-mono bg-muted/50 rounded-lg p-4 leading-relaxed overflow-x-auto whitespace-pre-wrap">{`# Acme Corp

> Acme builds developer tools for deploying and monitoring distributed systems.
- Primary use cases: deploying services, monitoring infrastructure, managing teams
- Integrations: GitHub, Datadog, PagerDuty, Slack

## Documentation
- [Getting Started](https://acme.com/docs/start): Step-by-step guide to deploying your first service. For engineers new to Acme.
- [API Reference](https://acme.com/api): Full REST API reference. For developers integrating Acme programmatically.

## Pricing
- [Plans & Pricing](https://acme.com/pricing): Compares Free, Pro, and Enterprise tiers. For teams evaluating Acme.`}</pre>
          <p className="text-xs text-muted-foreground">
            A single plain-text file, served at <code className="font-mono">yoursite.com/llms.txt</code>, readable by any AI system in under a second.
          </p>
        </div>

        {/* CTA */}
        <div className="text-center space-y-3 pb-4">
          <p className="text-sm text-muted-foreground">
            Crawl Atlas generates this file automatically. Grounded in your real page content, validated against the spec.
          </p>
          <a
            href="/"
            className="inline-flex items-center gap-1.5 rounded-lg bg-foreground text-background text-sm font-medium px-5 py-2.5 hover:opacity-90 transition-opacity"
          >
            Generate yours now
          </a>
        </div>

      </div>
    </div>
  );
}
