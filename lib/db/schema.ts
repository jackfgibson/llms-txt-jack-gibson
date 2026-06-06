import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  real,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---- Enums -----------------------------------------------------------------

export const crawlStatus = pgEnum("crawl_status", [
  "pending",
  "crawling",
  "generating",
  "completed",
  "failed",
]);

export const crawlMode = pgEnum("crawl_mode", ["initial", "recrawl"]);

export const generationMode = pgEnum("generation_mode", ["llm", "fallback"]);

// ---- Shared jsonb shapes (loose; refined by Zod in lib/) --------------------

type CrawlStats = Record<string, number>;
type CrawlProgress = { phase?: string; done?: number; total?: number };
type OpenGraph = Record<string, string>;
type ValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  score: number;
};
type CrawlDiff = {
  added: string[];
  removed: string[];
  changed: string[];
};

// ---- Tables (see MASTER_PLAN.md §8) -----------------------------------------

export const sites = pgTable("sites", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull(), // normalized origin
  slug: text("slug").notNull().unique(),
  scheduleCron: text("schedule_cron"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const crawls = pgTable(
  "crawls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    status: crawlStatus("status").notNull().default("pending"),
    mode: crawlMode("mode").notNull(),
    stats: jsonb("stats").$type<CrawlStats>(),
    progress: jsonb("progress").$type<CrawlProgress>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("crawls_site_id_idx").on(t.siteId)],
);

export const pages = pgTable(
  "pages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    crawlId: uuid("crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    depth: integer("depth").notNull().default(0),
    title: text("title"),
    metaDescription: text("meta_description"),
    og: jsonb("og").$type<OpenGraph>(),
    canonical: text("canonical"),
    lang: text("lang"),
    h1: text("h1"),
    mainText: text("main_text"),
    contentHash: text("content_hash"), // sha256 of normalized main text
    pageType: text("page_type"),
    score: real("score"),
    inlinkCount: integer("inlink_count").notNull().default(0),
    isJsShell: boolean("is_js_shell").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("pages_crawl_id_idx").on(t.crawlId),
    index("pages_content_hash_idx").on(t.contentHash),
    uniqueIndex("pages_crawl_url_uq").on(t.crawlId, t.url),
  ],
);

export const generations = pgTable(
  "generations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    crawlId: uuid("crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    version: integer("version").notNull(), // monotonic per site
    content: text("content").notNull(),
    validation: jsonb("validation").$type<ValidationResult>(),
    mode: generationMode("mode").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("generations_site_version_uq").on(t.siteId, t.version)],
);

export const changeEvents = pgTable(
  "change_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    fromCrawlId: uuid("from_crawl_id").references(() => crawls.id, {
      onDelete: "set null",
    }),
    toCrawlId: uuid("to_crawl_id")
      .notNull()
      .references(() => crawls.id, { onDelete: "cascade" }),
    diff: jsonb("diff").$type<CrawlDiff>(),
    regenerated: boolean("regenerated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("change_events_site_id_idx").on(t.siteId)],
);

// Description cache — unchanged pages (same content_hash) skip re-LLM.
export const pageDescriptions = pgTable("page_descriptions", {
  contentHash: text("content_hash").primaryKey(),
  description: text("description").notNull(),
  provenance: text("provenance"), // source snippet the description was grounded in
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
