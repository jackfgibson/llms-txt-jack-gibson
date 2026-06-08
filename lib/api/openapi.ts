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
    scheduleCron: z.string().nullable().openapi({ description: "Cron expression for recrawl schedule" }),
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
    version: z.number().int(),
    content: z.string().openapi({ description: "The generated llms.txt content" }),
    mode: z.enum(["llm", "fallback"]),
    createdAt: z.string().datetime(),
  }),
);

export const PostSiteBodySchema = registry.register(
  "PostSiteBody",
  z.object({
    url: z.string().url().openapi({ description: "The website URL to crawl and generate llms.txt for" }),
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
    latestGeneration: GenerationSchema.nullable(),
    recentCrawls: z.array(CrawlSchema),
  }),
);

export const TriggerCrawlResponseSchema = registry.register(
  "TriggerCrawlResponse",
  z.object({
    crawlId: z.string().uuid(),
  }),
);

export const ErrorSchema = registry.register(
  "Error",
  z.object({
    error: z.string(),
  }),
);

// ── Route registrations ──────────────────────────────────────────────────────

registry.registerPath({
  method: "post",
  path: "/api/sites",
  summary: "Register a site and trigger initial crawl",
  tags: ["Sites"],
  request: { body: { content: { "application/json": { schema: PostSiteBodySchema } } } },
  responses: {
    201: { description: "Site created and crawl triggered", content: { "application/json": { schema: PostSiteResponseSchema } } },
    400: { description: "Invalid URL", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/sites/{id}",
  summary: "Get site details with latest generation",
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
    202: { description: "Crawl triggered", content: { "application/json": { schema: TriggerCrawlResponseSchema } } },
    404: { description: "Site not found", content: { "application/json": { schema: ErrorSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/crawls/{id}",
  summary: "Get crawl status and details",
  tags: ["Crawls"],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: "Crawl details", content: { "application/json": { schema: CrawlSchema } } },
    404: { description: "Crawl not found", content: { "application/json": { schema: ErrorSchema } } },
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
