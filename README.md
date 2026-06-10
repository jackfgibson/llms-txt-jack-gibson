# Crawl Atlas: An Automated `llms.txt` Generator

**Live demo:** [crawlatlas.dev](https://crawlatlas.dev)

Paste a website URL and get back a spec-conforming [`llms.txt`](https://llmstxt.org) file which has been crawled, curated, and grounded in real page content. The file is served at a stable public URL, kept fresh by a nightly monitor, and (optionally) benchmarked across three different LLMs.


---

## What it does

1. **Crawls** the site with a bounded, same-origin BFS that follows in-page links from the homepage with depth and total page caps, has SSRF guarding, and a total time budget.
2. **Curates** the most useful pages by classifying and scoring each by type, depth, inlink count, and content quality, then groups them into H2 sections.
3. **Generates** descriptions grounded in each page's actual content (**never invented**). Pick any subset of providers per run: **Claude Haiku, GPT-4o mini, Gemini 3 Flash, and a no-LLM fallback** and each produces its own `llms.txt`, shown side by side as tabs.
4. **Conforms to the [llmstxt.org spec](https://llmstxt.org/#format) by construction**.
5. **Monitors** every site automatically: on its first successful generation a site is enrolled in a nightly (03:00 UTC) re-crawl. A diff engine compares page content hashes across runs and **regenerates only when something meaningful changed**. A manual **"Re-crawl now"** button triggers the same flow on demand.
6. **Compares models (Insights)**: when a crawl runs all three LLM providers, an on-demand Insights run benchmarks them: each model answers factual questions about the site (drawn from the *other* models' files) and votes on which file is best-structured; an LLM grader scores accuracy, a structure boost is applied, and a winner is crowned 👑.

The app is multi-page: **Generate** (submit form), **Results** (crawl history + the generated files), **Insights** (model benchmark), and **Why?** (project rationale).

---

## Tech stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router) · React 19 · TypeScript |
| UI | shadcn/ui · Tailwind v4|
| Database | Neon serverless Postgres (18) via `@neondatabase/serverless` (HTTP driver) |
| ORM / migrations | Drizzle + drizzle-kit |
| Jobs + cron | Inngest (durable, retry-safe step pipeline) |
| LLM | Anthropic (`@anthropic-ai/sdk`, default) · OpenAI · Gemini + Zod validation |
| Crawl / parse | `cheerio` · `@mozilla/readability` + `linkedom` · `p-limit` |
| Tests / docs | Vitest · OpenAPI via `@asteasolutions/zod-to-openapi` |

---

## How it works

A submission (`POST /api/sites`) creates `site` + `crawl` rows and fires a `site/crawl.requested` Inngest event. The durable pipeline (`inngest/pipeline/crawl-site.ts`) then runs as checkpointed, individually-retryable steps:

```
resolve-params         carry over providers/bounds from the prior crawl on recrawls
mark-crawling          status = crawling
crawl-extract-persist  crawl (same-origin BFS, SSRF-guarded) → extract metadata +
                       Readability + content_hash → store favicon → insert pages
curate                 classify + score + select top pages, group into H2 sections
decide-regen           diff vs. previous completed crawl → decide whether this
                       run regenerates; if so, write a change_event
── only if regenerating ──
mark-generating        status = generating
generate               for EACH selected provider, in parallel: tool-use LLM
                       (or fallback) → one llms.txt
persist-generation     one generations row per provider (shared version) → completed;
                       auto-enroll the site in the daily cron
generate-questions     if all 3 LLM providers ran: silently seed 2 Q&A pairs/model
── otherwise ──
discard-no-changes     delete the crawl row entirely (a no-change recrawl is never
                       recorded); the UI toasts "no changes found" and the previous
                       crawl + generation stay live
```

**Why Inngest?** A crawl can sometimes take more time than a serverless timeout would allow. Inngest breaks the work into durable steps where each is checkpointed and retried independently, and the whole function survives crashes. This is what makes the pipeline idempotent: writes are keyed by `crawl_id` (plus unique indexes), so a retried step never double-appends or creates a duplicate version.

**Why Neon?** Serverless Postgres scales to zero between requests. The `@neondatabase/serverless` HTTP driver runs one-shot queries with no connection-pool management in app code (PgBouncer pooling lives at the Neon `-pooler` hostname).

The UI polls `GET /api/crawls/:id` (~1s) for live progress, and the public `GET /<slug>/llms.txt` always serves the site's latest generation (prefers LLM output, then Claude → GPT → Gemini). Append `?provider=anthropic|openai|gemini|fallback` to pin the response to one provider's newest file, the per-model "Live URL" links in the UI use this.

### Pipeline stages

- **Crawler**: same-origin BFS from the homepage, bounded by max pages (5–50, default 20), max depth (1–3), and a 60s total time budget. Dedup is scheme/`www`/trailing-slash agnostic. Failures are lenient: only a crawl with zero usable pages fails.
- **SSRF guard**: every outbound fetch resolves the hostname and rejects private/loopback/link-local ranges and the cloud metadata IP. Re-validates the resolved IP after every redirect to close DNS-rebinding bypasses.
- **Extractor**: pulls `title`, `meta description`, OG tags, Readability `main_text`, and a SHA-256 `content_hash` from each page. Detects JS shells (SPA pages with no real content).
- **Curator**: classifies and scores each page by type, depth, inlink count, and content quality. Drops JS shells with no metadata. Groups pages into H2 sections (via LLM if a key is present, deterministic fallback otherwise).
- **Generation**: each selected provider runs in parallel via a shared `callWithTool` helper (tool-use + Zod validation). Descriptions are grounded in page content and cached by `content_hash` so unchanged pages skip the LLM. No API key? The fallback path uses meta descriptions and still emits a spec-valid file.
- **Monitoring**: diffs page `content_hash` snapshots across recrawls. If nothing meaningful changed, the crawl is discarded entirely (no history row, UI toasts "no changes found"). Regenerates only when needed.
- **Insights**: when all three LLM providers ran, each model answers the other models' factual questions about their files and votes on structure. A grader scores accuracy; structure votes add a boost. Highest total score wins 👑.

---

## Data model

Schema in `lib/db/schema.ts`. Nine tables:

| Table | Purpose |
|---|---|
| `sites` | One row per submitted origin: `url`, unique `slug`, `schedule_cron`, `favicon_url`. |
| `crawls` | One row per crawl attempt: `status` (`pending\|crawling\|generating\|completed\|failed`), `mode` (`initial\|recrawl`), requested `providers[]`, `stats`/`progress` jsonb, `automated` flag. |
| `pages` | One row per crawled page: extracted metadata, `content_hash`, classified `page_type`, curation `score`, `inlink_count`, `is_js_shell`. Unique on `(crawl_id, url)`. |
| `generations` | One row per file **per provider**: `version` (monotonic per site, shared across a crawl's provider rows), `content`, `mode` (`llm\|fallback`), `provider`. Unique on `(site_id, version, provider)`. |
| `change_events` | Written only on a re-crawl that regenerates: `from_crawl_id`, `to_crawl_id`, `diff` jsonb, `regenerated`. Unique on `to_crawl_id`. (No-change recrawls are discarded and leave no row anywhere.) |
| `page_descriptions` | Description cache keyed by `content_hash` (pk): `description`, grounding `provenance`. |
| `model_questions` | Silent per-model Q&A pairs seeded during an all-3-provider crawl. Unique on `generation_id`. |
| `insights` | One on-demand benchmark run per `(site_id, crawl_id)`: `status`, `winner`. |
| `model_eval_results` | Per-provider scores for an insights run: `accuracy`, `structure_placement`, `final_score`, detailed `details` jsonb. Unique on `(insight_id, provider)`. |

---

## Background jobs (Inngest)

Four durable functions (`inngest/functions.ts`):

| Function | Trigger | What it does |
|---|---|---|
| `crawl-site` | `site/crawl.requested` event | The full pipeline above. Automated recrawls share one serial queue slot; manual crawls each get their own. |
| `scheduled-recrawl` | Cron `0 3 * * *` (daily) | Enqueues a recrawl for every monitored site (any site with a `schedule_cron`). |
| `timeout-stale-crawls` | Cron `* * * * *` (per minute) | Marks any crawl stuck in `pending` for >60s as failed so the UI doesn't spin forever. |
| `run-insights` | `site/insights.requested` event | The on-demand model-comparison benchmark. |

Recrawls (manual + scheduled) fire without `providers`/bounds; `resolve-params` carries them over from the site's most recent configured crawl (defaulting to `["anthropic"]` / 20 / 3).

---

## API & docs

REST routes live under `app/api/` (sites, crawls, generations, insights, the Inngest serve handler, and the public llms.txt serve). Every route is documented via OpenAPI/Swagger, registered in `lib/api/openapi.ts` and served at **`/api/docs`** (JSON) and **`/api/docs/ui`** (interactive).

---

## Prerequisites

You need accounts and their credentials:

| Service | Purpose | Free tier |
|---|---|---|
| [Neon](https://neon.tech) | Serverless Postgres | ✅ |
| [Vercel](https://vercel.com) | Hosting | ✅ |
| [Inngest](https://inngest.com) | Durable crawl pipeline + cron | ✅ |
| [Anthropic](https://console.anthropic.com) | Claude Haiku for generation | pay-per-use (optional) |
| [OpenAI](https://platform.openai.com) | GPT-4o mini for generation | pay-per-use (optional) |
| [Google AI Studio](https://aistudio.google.com) | Gemini for generation | free quota (optional) |

The generator works end-to-end **without any LLM API key** via fallback mode. LLM keys only enable grounded descriptions and the Insights benchmark. **Inngest, however, runs the entire durable pipeline**, locally the Inngest dev server must be running for any crawl to execute.

---

## Local development

### 1. Clone and install

```bash
git clone https://github.com/jackfgibson/llms-txt-jack-gibson.git
cd llms-txt-jack-gibson
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and set:

```env
DATABASE_URL=          # Neon pooled connection string (-pooler hostname)
DATABASE_URL_UNPOOLED= # Neon direct connection string (for drizzle-kit migrations)
ANTHROPIC_API_KEY=     # Optional — app works without it via fallback mode
OPENAI_API_KEY=        # Optional
GOOGLE_API_KEY=        # Optional
INNGEST_DEV=1          # Required for local dev — talks to the Inngest dev server
```

`INNGEST_DEV=1` must **never** be set in production.

### 3. Run database migrations

```bash
npm run db:migrate
```

Runs `drizzle-kit migrate` against `DATABASE_URL_UNPOOLED` (the direct connection — PgBouncer can't run DDL reliably). All migration files are committed under `drizzle/`.

### 4. Start the Inngest dev server (separate terminal)

```bash
npx inngest-cli@latest dev
```

Starts the local Inngest dashboard at `http://localhost:8288` and runs the crawl pipeline triggered from the Next.js app in real time.

### 5. Start the Next.js app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Submit a URL, pick your providers, and watch the crawl run step-by-step in the Inngest dev dashboard.

---

## Run with Docker

The repo ships a production `Dockerfile` (Next.js standalone output, non-root, multi-stage) and a `docker-compose.yml`. This runs the **production build** — closest to deployment, not a hot-reload dev loop.

1. Fill in `.env.local` — Compose reads it via `env_file` and injects it at runtime (secrets are never baked into the image). A containerised run uses **Inngest Cloud**, not the local dev server, so set `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (Compose forces `INNGEST_DEV=0`).
2. Build and start:

   ```bash
   docker compose up --build
   ```

3. Open [http://localhost:3000](http://localhost:3000).

Notes:
- The app reaches Neon over HTTPS, so there's **no Postgres container**, just point `DATABASE_URL` at your Neon database.
- Migrations are **not** run by the container. Apply them separately: `npm run db:migrate` (against `DATABASE_URL_UNPOOLED`).
- The image builds without any secrets; everything is supplied at runtime by Compose.

---

## Deploying to production

1. **Deploy to Vercel.** Connect the GitHub repo; Vercel auto-deploys on every push to `master`.
2. **Set env vars** in Vercel → Settings → Environment Variables: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and any LLM keys you want. Do **not** set `INNGEST_DEV`.
3. **Wire Inngest.** Install the [Inngest Vercel integration](https://vercel.com/integrations/inngest) — it sets `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` automatically and points Inngest at `/api/inngest` on every deploy. Confirm the app `llms-txt-jack-gibson` shows all four functions: `crawl-site`, `timeout-stale-crawls`, `scheduled-recrawl`, `run-insights`.
4. **Run migrations** against production (idempotent): `DATABASE_URL_UNPOOLED="<your-direct-url>" npm run db:migrate`.

---

## Environment variable reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Neon pooled connection string. Use the `-pooler` hostname for serverless. |
| `DATABASE_URL_UNPOOLED` | Yes (migrations only) | Neon direct connection. Used by `drizzle-kit migrate`. |
| `ANTHROPIC_API_KEY` | No | Claude Haiku for LLM generation. App works without it via fallback mode. |
| `OPENAI_API_KEY` | No | GPT-4o mini for generation. |
| `GOOGLE_API_KEY` | No | Gemini for generation. |
| `INNGEST_DEV` | Local dev only | Set to `1` to use the local Inngest dev server. Never set in production. |
| `INNGEST_EVENT_KEY` | Production | Set automatically by the Inngest Vercel integration. |
| `INNGEST_SIGNING_KEY` | Production | Set automatically by the Inngest Vercel integration. |

Crawl bounds are **not** env vars, they're chosen per request from the submit form and clamped server-side (max pages 5–50, default 20; max depth 1–3, default 3). Concurrency and the 60s time budget are constants in `lib/crawler/`.

---

## Running tests

```bash
npm test
```

[Vitest](https://vitest.dev) suite:

- **SSRF guard** (`test/ssrf.test.ts`): all blocked IP ranges (IPv4 + IPv6) and the DNS-rebinding bypass via redirect re-validation.
- **Crawler** (`test/crawler.test.ts`): URL normalization, same-domain link extraction, JS-shell detection, crawl-failure leniency.
- **Extractor** (`test/extract.test.ts`): title/meta/OG extraction, Readability, content_hash, JS-shell detection.
- **Curator** (`test/curate.test.ts`): page classification, scoring, section grouping.
- **Monitor diff** (`test/monitor.test.ts`): all four diff cases and `isMeaningfulChange`.

---

## Non-goals (deliberate scope decisions)

The brief's explicit steer was *"correctness first; don't worry about auth; focus on infra best practices."* So these are intentional omissions, not gaps:

| Omitted | Reason |
|---|---|
| Auth / accounts / multi-tenant | Out of scope per the brief; the app is intentionally single-tenant. |
| Billing / teams / roles | Same. |
| Headless (JS) rendering | Static HTML only. JS-shell pages are detected, flagged, and deprioritised — not rendered (that would need persistent workers, not serverless functions). |
| Non-HTML inputs (PDFs, etc.) | The crawler only processes HTML responses. |

---

## Scaling note

The current architecture handles dozens of concurrent crawls comfortably. At much larger scale (thousands of sites, high-frequency recrawls) the natural bottleneck is the crawl queue, and the Inngest approach would be complemented by a Postgres `FOR UPDATE SKIP LOCKED` worker pattern, exactly-once dequeue, horizontal worker scaling, no external queue dependency. The `page_descriptions` cache (keyed by `content_hash`) already ensures unchanged pages never re-call the LLM no matter how many workers run in parallel.
