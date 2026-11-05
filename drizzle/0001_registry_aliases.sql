ALTER TABLE "design_system" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "design_system" ADD COLUMN "replaced_by_slug" text;--> statement-breakpoint
ALTER TABLE "design_system" ADD COLUMN "related_slugs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "extraction_lookup_idx" ON "extraction" USING btree ("design_system_id","entity_kind","entity_key","published","created_at");