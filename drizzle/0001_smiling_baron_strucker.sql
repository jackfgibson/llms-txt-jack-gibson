DROP INDEX "generations_site_version_uq";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "provider" text DEFAULT 'anthropic' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generations_site_version_provider_uq" ON "generations" USING btree ("site_id","version","provider");