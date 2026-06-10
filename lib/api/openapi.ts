import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

// ── Shared schemas ───────────────────────────────────────────────────────────

export const SiteSchema = registry.register(
  "Site",
  z.object({
    id: z.string().uuid().openapi({ description: "Site UUID" }),
    url: z.string().url().openapi({ description: "Normalized origin URL" }),
    slug: z.string().openapi({ description: "URL-safe slug derived from hostname" }),
    scheduleCron: z.string().nullable().openapi({ description: "Cron expression for the nightly recrawl (set after the first successful generation)" }),
    faviconUrl: z.string().nullable().openapi({ description: "Favicon URL extracted from the homepage" }),
    createdAt: z.string().datetime().openapi({ description: "ISO 8601 creation timestamp" }),
  }),
);

export const CrawlSchema = registry.register(
  "Crawl",
  z.object({
    id: z.string().uuid(),
    siteId: z.string().uuid(),
    status: z.enum(["pending", "crawling", "generating", "completed", "failed"]),
    mode: z.enum(["initial", "recrawl"]),
    providers: z.array(z.string()).nullable().openapi({ description: "Requested LLM providers for this crawl, e.g. ['anthropic','openai','fallback']" }),
    automated: z.boolean().openapi({ description: "True if enqueued by the nightly cron rather than a user" }),
    stats: z.record(z.string(), z.number()).nullable(),
    progress: z
      .object({
        phase: z.string().optional(),
        done: z.number().optional(),
        total: z.number().optional(),
      })
      .nullable(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
  }),
);

export const GenerationSchema = registry.register(
  "Generation",
  z.object({
    id: z.string().uuid(),
    siteId: z.string().uuid(),
    crawlId: z.string().uuid(),
    version: z.number().int().openapi({ description: "Monotonic per site; shared across a crawl's parallel provider rows" }),
    content: z.string().openapi({ description: "The generated llms.txt content" }),
    mode: z.enum(["llm", "fallback"]),
    provider: z.string().openapi({ description: "'anthropic' | 'openai' | 'gemini' | 'fallback'" }),
    createdAt: z.string().datetime(),
  }),
);

// Reduced generation shape returned inline by GET /api/crawls/{id}.
export const CrawlGenerationSchema = registry.register(
  "CrawlGeneration",
  z.object({
    id: z.string().uuid(),
    content: z.string(),
    provider: z.string(),
    mode: z.enum(["llm", "fallback"]),
    version: z.number().int(),
    createdAt: z.string().datetime(),
  }),
);

export const ErrorSchema = registry.register(
  "Error",
  z.object({
    error: z.string(),
  }),
);

// ── Sites: request/response bodies ───────────────────────────────────────────

export const PostSiteBodySchema = registry.register(
  "PostSiteBody",
  z.object({
    url: z.string().url().openapi({ description: "The website URL to crawl and generate llms.txt for" }),
    providers: z
      .array(z.enum(["anthropic", "openai", "gemini", "fallback"]))
      .min(1)
      .optional()
      .openapi({ description: "Providers to generate with (each yields its own file). Defaults to ['anthropic','openai','fallback']" }),
    maxPages: z.number().int().min(5).max(50).optional().openapi({ description: "Page budget (default 20)" }),
    maxDepth: z.number().int().min(1).max(3).optional().openapi({ description: "Crawl depth (default 3)" }),
  }),
);

export const PostSiteResponseSchema = registry.register(
  "PostSiteResponse",
  z.object({
    site: SiteSchema,
    crawlId: z.string().uuid(),
  }),
);

export const GetSiteResponseSchema = registry.register(
  "GetSiteResponse",
  z.object({
    site: SiteSchema,
    latestGeneration: GenerationSchema.nullable().openapi({ description: "Best generation of the latest version (prefers Anthropic)" }),
    latestGenerations: z.array(GenerationSchema).openapi({ description: "All provider rows of the latest version" }),
    recentCrawls: z.array(CrawlSchema),
  }),
);

export const TriggerCrawlResponseSchema = registry.register(
  "TriggerCrawlResponse",
  z.object({
    crawlId: z.string().uuid(),
  }),
);

// ── Crawls: list + detail + change event ─────────────────────────────────────

export const CrawlRunSchema = registry.register(
  "CrawlRun",
  z.object({
    crawlId: z.string().uuid(),
    status: z.string(),
    providers: z.array(z.string()),
    submittedAt: z.string().datetime(),
    automated: z.boolean(),
  }),
);

export const SiteGroupSchema = registry.register(
  "SiteGroup",
  z.object({
    siteId: z.string().uuid(),
    hostname: z.string(),
    slug: z.string(),
    faviconUrl: z.string().nullable(),
    latest: CrawlRunSchema,
    previousRuns: z.array(CrawlRunSchema),
    hasInsights: z.boolean(),
  }),
);

export const GetCrawlResponseSchema = registry.register(
  "GetCrawlResponse",
  CrawlSchema.extend({
    reusedGeneration: z.boolean().openapi({ description: "True when a no-change recrawl reused the site's existing latest generation" }),
    generations: z.array(CrawlGenerationSchema),
  }),
);

export const ChangeEventSchema = registry.register(
  "ChangeEvent",
  z.object({
    id: z.string().uuid(),
    fromCrawlId: z.string().uuid().nullable(),
    toCrawlId: z.string().uuid(),
    diff: z
      .object({
        added: z.array(z.string()),
        removed: z.array(z.string()),
        changed: z.array(z.string()),
      })
      .nullable(),
    regenerated: z.boolean(),
    createdAt: z.string().datetime(),
  }),
);

// ── Insights schemas ─────────────────────────────────────────────────────────

export const ModelEvalResultSchema = registry.register(
  "ModelEvalResult",
  z.object({
    id: z.string().uuid(),
    insightId: z.string().uuid(),
    provider: z.string().openapi({ description: "'anthropic' | 'openai' | 'gemini'" }),
    accuracy: z.number().openapi({ description: "Sum of 4 answer scores (0.0–10.0)" }),
    structurePlacement: z.enum(["Excellent", "Great", "Good"]),
    finalScore: z.number().openapi({ description: "accuracy + structure boost" }),
    details: z.object({
      questionsAnswered: z.array(
        z.object({
          question: z.string(),
          correctAnswer: z.string(),
          givenAnswer: z.string(),
          score: z.number(),
          reasoning: z.string(),
        }),
      ),
      structurePick: z.string(),
    }),
    createdAt: z.string().datetime(),
  }),
);

export const InsightResultSchema = registry.register(
  "InsightResult",
  z.object({
    id: z.string().uuid(),
    siteId: z.string().uuid(),
    crawlId: z.string().uuid(),
    status: z.enum(["pending", "running", "completed", "failed"]),
    winner: z.string().nullable(),
    createdAt: z.string().datetime(),
    finishedAt: z.string().datetime().nullable(),
    evalResults: z.array(ModelEvalResultSchema),
  }),
);

export const TriggerInsightResponseSchema = registry.register(
  "TriggerInsightResponse",
  z.object({
    insightId: z.string().uuid(),
    status: z.string(),
  }),
);

// ── Route registrations (scoped to /api) ─────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/sites",
  summary: "Register a site and trigger an initial crawl",
  tags: ["Sites"],
  request: { body: { content: { "application/json": { schema: PostSiteBodySchema } } } },
  responses: {
    201: { description: "Site created (or reused) and crawl triggered", content: { "application/json": { schema: PostSiteResponseSchema } } },
    400: { description: "Invalid JSON or body", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "Site unreachable", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites/{id}",
  summary: "Get site details with the latest generation(s) and recent crawls",
  tags: ["Sites"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Site details", content: { "application/json": { schema: GetSiteResponseSchema } } },
    404: { description: "Site not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/sites/{id}/crawl",
  summary: "Trigger a recrawl for an existing site",
  tags: ["Sites"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    202: { description: "Recrawl triggered", content: { "application/json": { schema: TriggerCrawlResponseSchema } } },
    404: { description: "Site not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites/{id}/generation",
  summary: "Get one provider's raw llms.txt content for a specific crawl",
  tags: ["Sites"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      crawlId: z.string().uuid().openapi({ description: "The crawl whose generation to return" }),
      provider: z.string().openapi({ description: "anthropic | openai | gemini | fallback" }),
    }),
  },
  responses: {
    200: { description: "Raw llms.txt", content: { "text/plain": { schema: z.string() } } },
    400: { description: "Missing crawlId or provider", content: { "application/json": { schema: ErrorSchema } } },
    404: { description: "Generation not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/crawls",
  summary: "List sites with their crawl history (newest first), grouped by site",
  tags: ["Crawls"],
  responses: {
    200: { description: "Site groups", content: { "application/json": { schema: z.array(SiteGroupSchema) } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/crawls/{id}",
  summary: "Get crawl status plus this crawl's generations",
  tags: ["Crawls"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Crawl details", content: { "application/json": { schema: GetCrawlResponseSchema } } },
    404: { description: "Crawl not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/crawls/{id}/change-event",
  summary: "Get the monitor diff recorded for this crawl (null if none)",
  tags: ["Crawls"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Change event, or null", content: { "application/json": { schema: ChangeEventSchema.nullable() } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites/{id}/insights",
  summary: "Get model insights for a site",
  tags: ["Insights"],
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({
      crawlId: z.string().uuid().optional().openapi({ description: "Restrict to a specific crawl" }),
      all: z.enum(["true", "false"]).optional().openapi({ description: "When 'true', return every insights run for the site as an array" }),
    }),
  },
  responses: {
    200: {
      description: "Latest insights (object, or null), or an array when all=true",
      content: {
        "application/json": {
          schema: z.union([InsightResultSchema, z.array(InsightResultSchema)]).nullable(),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/sites/{id}/insights",
  summary: "Trigger a model insights evaluation for a site",
  tags: ["Insights"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Existing completed insights returned", content: { "application/json": { schema: InsightResultSchema } } },
    202: {
      description: "Evaluation triggered, or already in flight",
      content: { "application/json": { schema: z.union([InsightResultSchema, TriggerInsightResponseSchema]) } },
    },
    404: { description: "Site not found", content: { "application/json": { schema: ErrorSchema } } },
    422: { description: "No eligible crawl (need all 3 LLM providers)", content: { "application/json": { schema: ErrorSchema } } },
  },
});

// ── Document builder (lazy, cached) ─────────────────────────────────────────

let _doc: ReturnType<OpenApiGeneratorV3["generateDocument"]> | null = null;

export function getOpenApiDocument() {
  if (_doc) return _doc;
  const generator = new OpenApiGeneratorV3(registry.definitions);
  _doc = generator.generateDocument({
    openapi: "3.0.0",
    info: {
      title: "llms-txt API",
      version: "1.0.0",
      description: "API for automated llms.txt generation from website crawls.",
    },
    servers: [{ url: "/", description: "Current server" }],
  });
  return _doc;
}
