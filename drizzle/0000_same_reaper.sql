CREATE TYPE "public"."crawl_mode" AS ENUM('initial', 'recrawl');--> statement-breakpoint
CREATE TYPE "public"."crawl_status" AS ENUM('pending', 'crawling', 'generating', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."generation_mode" AS ENUM('llm', 'fallback');--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"from_crawl_id" uuid,
	"to_crawl_id" uuid NOT NULL,
	"diff" jsonb,
	"regenerated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"status" "crawl_status" DEFAULT 'pending' NOT NULL,
	"mode" "crawl_mode" NOT NULL,
	"stats" jsonb,
	"progress" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"crawl_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"validation" jsonb,
	"mode" "generation_mode" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_descriptions" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"provenance" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_id" uuid NOT NULL,
	"url" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"title" text,
	"meta_description" text,
	"og" jsonb,
	"canonical" text,
	"lang" text,
	"h1" text,
	"main_text" text,
	"content_hash" text,
	"page_type" text,
	"score" real,
	"inlink_count" integer DEFAULT 0 NOT NULL,
	"is_js_shell" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"slug" text NOT NULL,
	"schedule_cron" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_from_crawl_id_crawls_id_fk" FOREIGN KEY ("from_crawl_id") REFERENCES "public"."crawls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_to_crawl_id_crawls_id_fk" FOREIGN KEY ("to_crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_crawl_id_crawls_id_fk" FOREIGN KEY ("crawl_id") REFERENCES "public"."crawls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_events_site_id_idx" ON "change_events" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "crawls_site_id_idx" ON "crawls" USING btree ("site_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generations_site_version_uq" ON "generations" USING btree ("site_id","version");--> statement-breakpoint
CREATE INDEX "pages_crawl_id_idx" ON "pages" USING btree ("crawl_id");--> statement-breakpoint
CREATE INDEX "pages_content_hash_idx" ON "pages" USING btree ("content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "pages_crawl_url_uq" ON "pages" USING btree ("crawl_id","url");