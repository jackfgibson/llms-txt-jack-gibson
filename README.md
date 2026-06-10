# Crawl Atlas: An Automated `llms.txt` Generator

**Live deployment:** [crawlatlas.dev](https://crawlatlas.dev)

[Slideshow Presentation](https://docs.google.com/presentation/d/1fYu8n5PcSyk53cmv3MURwVS5EBjiqF29BAttDN8j6x8/edit?usp=sharing)

Paste a website URL and get back a spec-conforming [`llms.txt`](https://llmstxt.org) file which has been crawled, curated, and grounded in real page content. The file is served at a stable public URL, kept fresh by a nightly monitor, and (optionally) benchmarked across three different LLMs.

<img width="1808" height="988" alt="Screenshot 2026-06-10 140015" src="https://github.com/user-attachments/assets/554eebfa-2d05-40fc-a3a1-13e26a387cc4" />

---

## Features & How it Works

1. **Crawls** the site with a bounded, same-origin BFS that follows in-page links from the homepage with depth and total page caps, has SSRF guarding, and a total time budget.
2. **Curates** the most useful pages by classifying and scoring each by type, depth, inlink count, and content quality, then groups them into H2 sections.
3. **Generates** descriptions grounded in each page's actual content (**never invented**). Pick any subset of providers per run: **Claude Haiku, GPT-4o mini, Gemini 3 Flash, and a no-LLM fallback** and each produces its own `llms.txt`, shown side by side as tabs.
4. **Conforms to the [llmstxt.org spec](https://llmstxt.org/#format) by construction**.

<img width="1147" height="822" alt="Screenshot 2026-06-10 140318" src="https://github.com/user-attachments/assets/00067337-2441-43d7-8905-466fe9e14115" />

5. **Monitors** every site automatically: on its first successful generation a site is enrolled in a nightly (03:00 UTC) re-crawl. A diff engine compares page content hashes across runs and **regenerates only when something meaningful changed**. A manual **"Re-crawl now"** button triggers the same flow on demand.
6. **Compares models (Insights)**: when a crawl runs all three LLM providers, an on-demand Insights run benchmarks them: each model answers factual questions about the site (drawn from the *other* models' files) and votes on which file is best-structured; an LLM grader scores accuracy, a structure boost is applied, and a winner is crowned 👑.

<img width="1082" height="994" alt="Screenshot 2026-06-10 140430" src="https://github.com/user-attachments/assets/2769a354-5542-46e4-a1c5-7c8adc444e40" />

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

## Architecture

<img width="954" height="1097" alt="crawlAtlasArchitecture" src="https://github.com/user-attachments/assets/0168d884-6464-4442-a6ed-c9bf23bf480b" />

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

## API & docs

[Swagger UI](https://www.crawlatlas.dev/api/docs/ui)

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

[Vitest](https://vitest.dev)

```bash
npm test
```

---

## Scaling note

The current architecture handles several concurrent crawls comfortably. At much larger scale (thousands of sites, high-frequency recrawls) the natural bottleneck is the crawl queue, and the Inngest approach would be complemented by a Postgres `FOR UPDATE SKIP LOCKED` worker pattern, exactly-once dequeue, horizontal worker scaling, no external queue dependency. The `page_descriptions` cache (keyed by `content_hash`) already ensures unchanged pages never re-call the LLM no matter how many workers run in parallel.
