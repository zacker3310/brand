CREATE TYPE "public"."doc_access" AS ENUM('public', 'partial', 'private', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."ingestion_status" AS ENUM('not_started', 'queued', 'running', 'metadata_only', 'partial', 'indexed', 'failed', 'blocked', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'dead');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('active', 'maintenance', 'deprecated', 'archived', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."publish_state" AS ENUM('draft', 'published', 'quarantined', 'retired');--> statement-breakpoint
CREATE TYPE "public"."redistribution" AS ENUM('permitted', 'conditional', 'restricted', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."registry_status" AS ENUM('candidate', 'verified', 'rejected', 'duplicate', 'replaced');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('pending', 'running', 'succeeded', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."system_category" AS ENUM('design-system', 'design-language', 'component-library', 'headless-library', 'css-framework', 'ui-framework', 'styling-engine', 'web-components', 'commercial-suite', 'pattern-library');--> statement-breakpoint
CREATE TYPE "public"."token_category" AS ENUM('color', 'typography', 'spacing', 'shape', 'elevation', 'motion', 'layout', 'opacity', 'other');--> statement-breakpoint
CREATE TYPE "public"."token_tier" AS ENUM('primitive', 'semantic', 'component');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('verified', 'inferred', 'unverified', 'unavailable', 'conflicting');--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"display_name" text,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "asset_reference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid,
	"component_id" uuid,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"permission" text NOT NULL,
	"license_id" uuid,
	"attribution" text,
	"alt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmark" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"change_kind" text NOT NULL,
	"field_changes" jsonb,
	"run_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"note" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"is_curated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparison" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" text,
	"title" text NOT NULL,
	"component_type_id" uuid,
	"system_slugs" text[] NOT NULL,
	"criteria" jsonb,
	"is_featured" boolean DEFAULT false NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparison_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "component_accessibility" (
	"component_id" uuid PRIMARY KEY NOT NULL,
	"aria_pattern" text,
	"roles" text[],
	"keyboard" jsonb,
	"guidance" text,
	"screen_reader" text,
	"focus_management" text,
	"wcag_criteria" text[],
	"docs_url" text,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_example" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"language" text,
	"code" text,
	"url" text,
	"license_id" uuid,
	"attribution" text
);
--> statement-breakpoint
CREATE TABLE "component_framework" (
	"component_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"package_name" text,
	"import_name" text,
	"source_url" text,
	CONSTRAINT "component_framework_component_id_framework_id_pk" PRIMARY KEY("component_id","framework_id")
);
--> statement-breakpoint
CREATE TABLE "component_property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"implementation" text DEFAULT 'default' NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"default_value" text,
	"required" boolean,
	"deprecated" boolean DEFAULT false NOT NULL,
	"description" text,
	"allowed_values" text[],
	"source_url" text
);
--> statement-breakpoint
CREATE TABLE "component_relationship" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_component_id" uuid NOT NULL,
	"to_component_id" uuid,
	"to_component_type_id" uuid,
	"kind" text NOT NULL,
	"verification_state" "verification_state" DEFAULT 'verified' NOT NULL,
	"source_url" text
);
--> statement-breakpoint
CREATE TABLE "component_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"canonical_state" text,
	"description" text,
	"source_url" text
);
--> statement-breakpoint
CREATE TABLE "component_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"description" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"near_synonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	"aria_pattern" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "component_type_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "component_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"axis" text DEFAULT 'variant' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_url" text,
	"location" text
);
--> statement-breakpoint
CREATE TABLE "component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid NOT NULL,
	"component_type_id" uuid,
	"classification_state" "verification_state" DEFAULT 'inferred' NOT NULL,
	"classification_method" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"docs_url" text,
	"source_code_url" text,
	"lifecycle" text DEFAULT 'unknown' NOT NULL,
	"sizes" text[],
	"responsive_guidance" text,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"license_id" uuid,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"publish_state" "publish_state" DEFAULT 'published' NOT NULL,
	"content_hash" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_pattern" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid NOT NULL,
	"pattern_type_id" uuid,
	"classification_state" "verification_state" DEFAULT 'inferred' NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"docs_url" text,
	"coverage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"publish_state" "publish_state" DEFAULT 'published' NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_system_framework" (
	"design_system_id" uuid NOT NULL,
	"framework_id" uuid NOT NULL,
	"support" text DEFAULT 'official' NOT NULL,
	"package_name" text,
	"verification_state" "verification_state" DEFAULT 'unverified' NOT NULL,
	"source_url" text,
	CONSTRAINT "design_system_framework_design_system_id_framework_id_pk" PRIMARY KEY("design_system_id","framework_id")
);
--> statement-breakpoint
CREATE TABLE "design_system_platform" (
	"design_system_id" uuid NOT NULL,
	"platform_id" uuid NOT NULL,
	"verification_state" "verification_state" DEFAULT 'unverified' NOT NULL,
	"source_url" text,
	CONSTRAINT "design_system_platform_design_system_id_platform_id_pk" PRIMARY KEY("design_system_id","platform_id")
);
--> statement-breakpoint
CREATE TABLE "design_system_tag" (
	"design_system_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"verification_state" "verification_state" DEFAULT 'inferred' NOT NULL,
	CONSTRAINT "design_system_tag_design_system_id_tag_id_pk" PRIMARY KEY("design_system_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "design_system" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"organization_id" uuid,
	"category" "system_category" NOT NULL,
	"summary" text,
	"philosophy" text,
	"principles" jsonb,
	"homepage_url" text,
	"docs_url" text,
	"repository_url" text,
	"figma_url" text,
	"storybook_url" text,
	"packages" jsonb,
	"license_id" uuid,
	"doc_access" "doc_access" DEFAULT 'unknown' NOT NULL,
	"maintenance_status" "maintenance_status" DEFAULT 'unknown' NOT NULL,
	"latest_version" text,
	"latest_release_at" timestamp with time zone,
	"registry_status" "registry_status" DEFAULT 'candidate' NOT NULL,
	"registry_rank" integer,
	"registry_notes" text,
	"duplicate_of_slug" text,
	"replaces_slug" text,
	"registry_evidence" jsonb,
	"ingestion_status" "ingestion_status" DEFAULT 'not_started' NOT NULL,
	"adapter_id" text,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_ingested_at" timestamp with time zone,
	"coverage" jsonb,
	"publish_state" "publish_state" DEFAULT 'draft' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_system_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "extraction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"design_system_id" uuid NOT NULL,
	"entity_kind" text NOT NULL,
	"entity_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"validation" text DEFAULT 'pending' NOT NULL,
	"issues" jsonb,
	"published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "framework" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'web' NOT NULL,
	"website_url" text,
	CONSTRAINT "framework_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ingestion_error" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid,
	"job_id" uuid,
	"design_system_id" uuid,
	"stage" text NOT NULL,
	"severity" text DEFAULT 'error' NOT NULL,
	"code" text NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"details" jsonb,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text DEFAULT 'ingest' NOT NULL,
	"kind" text NOT NULL,
	"run_id" uuid,
	"design_system_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingestion_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid,
	"adapter_id" text,
	"adapter_version" text,
	"kind" text NOT NULL,
	"status" "run_status" DEFAULT 'pending' NOT NULL,
	"stage" text,
	"triggered_by" text DEFAULT 'cli' NOT NULL,
	"checkpoint" jsonb,
	"stats" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"spdx_id" text,
	"name" text NOT NULL,
	"url" text,
	"is_open_source" boolean,
	"redistribution" "redistribution" DEFAULT 'unknown' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "license_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "parsed_fragment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"adapter_id" text NOT NULL,
	"adapter_version" text NOT NULL,
	"content_hash" text NOT NULL,
	"fragments" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pattern_component" (
	"pattern_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"role" text,
	CONSTRAINT "pattern_component_pattern_id_component_id_pk" PRIMARY KEY("pattern_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "pattern_type" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pattern_type_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "platform_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "search_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"system_slug" text,
	"title" text NOT NULL,
	"subtitle" text,
	"body" text,
	"keywords" text,
	"url" text NOT NULL,
	"facets" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"boost" double precision DEFAULT 1 NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') || setweight(to_tsvector('simple'::regconfig, coalesce(keywords, '')), 'A') || setweight(to_tsvector('english'::regconfig, coalesce(subtitle, '')), 'B') || setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'C')) STORED,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"design_system_id" uuid NOT NULL,
	"url" text NOT NULL,
	"doc_kind" text NOT NULL,
	"title" text,
	"content_type" text,
	"etag" text,
	"last_modified" text,
	"last_hash" text,
	"last_fetched_at" timestamp with time zone,
	"last_status" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_document_id" uuid NOT NULL,
	"run_id" uuid,
	"content_hash" text NOT NULL,
	"http_status" integer NOT NULL,
	"content_type" text,
	"byte_size" integer NOT NULL,
	"etag" text,
	"last_modified" text,
	"title" text,
	"excerpt" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"url" text NOT NULL,
	"label" text,
	"is_official" boolean DEFAULT true NOT NULL,
	"robots_allowed" boolean,
	"last_checked_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"discovered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tag" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "tag_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "token_alias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"target_ref" text NOT NULL,
	"target_token_id" uuid,
	"state" text NOT NULL,
	"depth" integer
);
--> statement-breakpoint
CREATE TABLE "token_set" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_system_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"theme" text,
	"format" text NOT NULL,
	"source_url" text NOT NULL,
	"package_name" text,
	"package_version" text,
	"license_id" uuid,
	"redistribution" "redistribution" DEFAULT 'unknown' NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"publish_state" "publish_state" DEFAULT 'published' NOT NULL,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_id" uuid NOT NULL,
	"component_id" uuid NOT NULL,
	"property" text,
	"source_url" text
);
--> statement-breakpoint
CREATE TABLE "token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_set_id" uuid NOT NULL,
	"design_system_id" uuid NOT NULL,
	"name" text NOT NULL,
	"path" text[] NOT NULL,
	"css_var" text,
	"category" "token_category" NOT NULL,
	"type" text,
	"tier" "token_tier",
	"tier_state" "verification_state" DEFAULT 'inferred' NOT NULL,
	"raw_value" jsonb,
	"resolved_value" jsonb,
	"value_text" text,
	"is_alias" boolean DEFAULT false NOT NULL,
	"alias_state" text,
	"description" text,
	"deprecated" boolean DEFAULT false NOT NULL,
	"location" text
);
--> statement-breakpoint
CREATE TABLE "verification_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"design_system_id" uuid,
	"field" text NOT NULL,
	"claim" jsonb,
	"source_url" text NOT NULL,
	"source_title" text,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"snapshot_id" uuid,
	"extraction_method" text NOT NULL,
	"location" text,
	"excerpt" text,
	"state" "verification_state" NOT NULL,
	"confidence" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "asset_reference" ADD CONSTRAINT "asset_reference_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reference" ADD CONSTRAINT "asset_reference_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reference" ADD CONSTRAINT "asset_reference_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_event" ADD CONSTRAINT "change_event_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_event" ADD CONSTRAINT "change_event_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_item" ADD CONSTRAINT "collection_item_collection_id_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparison" ADD CONSTRAINT "comparison_component_type_id_component_type_id_fk" FOREIGN KEY ("component_type_id") REFERENCES "public"."component_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_accessibility" ADD CONSTRAINT "component_accessibility_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_example" ADD CONSTRAINT "component_example_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_example" ADD CONSTRAINT "component_example_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_framework" ADD CONSTRAINT "component_framework_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_framework" ADD CONSTRAINT "component_framework_framework_id_framework_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."framework"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_property" ADD CONSTRAINT "component_property_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_relationship" ADD CONSTRAINT "component_relationship_from_component_id_component_id_fk" FOREIGN KEY ("from_component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_relationship" ADD CONSTRAINT "component_relationship_to_component_id_component_id_fk" FOREIGN KEY ("to_component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_relationship" ADD CONSTRAINT "component_relationship_to_component_type_id_component_type_id_fk" FOREIGN KEY ("to_component_type_id") REFERENCES "public"."component_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_state" ADD CONSTRAINT "component_state_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_type" ADD CONSTRAINT "component_type_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_variant" ADD CONSTRAINT "component_variant_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_component_type_id_component_type_id_fk" FOREIGN KEY ("component_type_id") REFERENCES "public"."component_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component" ADD CONSTRAINT "component_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_pattern" ADD CONSTRAINT "design_pattern_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_pattern" ADD CONSTRAINT "design_pattern_pattern_type_id_pattern_type_id_fk" FOREIGN KEY ("pattern_type_id") REFERENCES "public"."pattern_type"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_framework" ADD CONSTRAINT "design_system_framework_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_framework" ADD CONSTRAINT "design_system_framework_framework_id_framework_id_fk" FOREIGN KEY ("framework_id") REFERENCES "public"."framework"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_platform" ADD CONSTRAINT "design_system_platform_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_platform" ADD CONSTRAINT "design_system_platform_platform_id_platform_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platform"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_tag" ADD CONSTRAINT "design_system_tag_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system_tag" ADD CONSTRAINT "design_system_tag_tag_id_tag_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tag"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system" ADD CONSTRAINT "design_system_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_system" ADD CONSTRAINT "design_system_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction" ADD CONSTRAINT "extraction_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_job_id_ingestion_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ingestion_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_error" ADD CONSTRAINT "ingestion_error_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_job" ADD CONSTRAINT "ingestion_job_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_run" ADD CONSTRAINT "ingestion_run_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parsed_fragment" ADD CONSTRAINT "parsed_fragment_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_component" ADD CONSTRAINT "pattern_component_pattern_id_design_pattern_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."design_pattern"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pattern_component" ADD CONSTRAINT "pattern_component_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_source_id_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_document" ADD CONSTRAINT "source_document_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshot" ADD CONSTRAINT "source_snapshot_source_document_id_source_document_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_document"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_snapshot" ADD CONSTRAINT "source_snapshot_run_id_ingestion_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ingestion_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "source_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_alias" ADD CONSTRAINT "token_alias_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_alias" ADD CONSTRAINT "token_alias_target_token_id_token_id_fk" FOREIGN KEY ("target_token_id") REFERENCES "public"."token"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_set" ADD CONSTRAINT "token_set_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_set" ADD CONSTRAINT "token_set_license_id_license_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."license"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_token_id_token_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."token"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_component_id_component_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."component"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_token_set_id_token_set_id_fk" FOREIGN KEY ("token_set_id") REFERENCES "public"."token_set"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token" ADD CONSTRAINT "token_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_design_system_id_design_system_id_fk" FOREIGN KEY ("design_system_id") REFERENCES "public"."design_system"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_snapshot_id_source_snapshot_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshot"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_uq" ON "asset_reference" USING btree ("design_system_id","component_id","kind","url");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmark_uq" ON "bookmark" USING btree ("owner_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_kind_slug_uq" ON "category" USING btree ("kind","slug");--> statement-breakpoint
CREATE INDEX "change_event_system_idx" ON "change_event" USING btree ("design_system_id","occurred_at");--> statement-breakpoint
CREATE INDEX "change_event_time_idx" ON "change_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_item_uq" ON "collection_item" USING btree ("collection_id","entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_owner_slug_uq" ON "collection" USING btree ("owner_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "example_component_slug_uq" ON "component_example" USING btree ("component_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "property_component_impl_name_uq" ON "component_property" USING btree ("component_id","implementation","name");--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_uq" ON "component_relationship" USING btree ("from_component_id","kind","to_component_id","to_component_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_component_slug_uq" ON "component_state" USING btree ("component_id","slug");--> statement-breakpoint
CREATE INDEX "component_type_category_idx" ON "component_type" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_component_axis_slug_uq" ON "component_variant" USING btree ("component_id","axis","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "component_system_slug_uq" ON "component" USING btree ("design_system_id","slug");--> statement-breakpoint
CREATE INDEX "component_type_idx" ON "component" USING btree ("component_type_id");--> statement-breakpoint
CREATE INDEX "component_name_trgm" ON "component" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "pattern_system_slug_uq" ON "design_pattern" USING btree ("design_system_id","slug");--> statement-breakpoint
CREATE INDEX "pattern_type_idx" ON "design_pattern" USING btree ("pattern_type_id");--> statement-breakpoint
CREATE INDEX "design_system_category_idx" ON "design_system" USING btree ("category");--> statement-breakpoint
CREATE INDEX "design_system_publish_idx" ON "design_system" USING btree ("publish_state","registry_status");--> statement-breakpoint
CREATE INDEX "design_system_name_trgm" ON "design_system" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "extraction_run_entity_uq" ON "extraction" USING btree ("run_id","entity_kind","entity_key");--> statement-breakpoint
CREATE INDEX "extraction_system_idx" ON "extraction" USING btree ("design_system_id","validation");--> statement-breakpoint
CREATE INDEX "ingestion_error_system_idx" ON "ingestion_error" USING btree ("design_system_id","created_at");--> statement-breakpoint
CREATE INDEX "ingestion_error_run_idx" ON "ingestion_error" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "ingestion_job" USING btree ("queue","status","priority","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_live_dedupe_uq" ON "ingestion_job" USING btree ("dedupe_key") WHERE "ingestion_job"."status" in ('queued','running') and "ingestion_job"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "job_run_idx" ON "ingestion_job" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "run_system_idx" ON "ingestion_run" USING btree ("design_system_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "parsed_fragment_uq" ON "parsed_fragment" USING btree ("source_document_id","adapter_id","adapter_version","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "search_document_entity_uq" ON "search_document" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_document_tsv_idx" ON "search_document" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_document_title_trgm" ON "search_document" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "search_document_type_idx" ON "search_document" USING btree ("entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "source_document_system_url_uq" ON "source_document" USING btree ("design_system_id","url");--> statement-breakpoint
CREATE INDEX "source_document_source_idx" ON "source_document" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_doc_hash_uq" ON "source_snapshot" USING btree ("source_document_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "source_system_url_uq" ON "source" USING btree ("design_system_id","url");--> statement-breakpoint
CREATE INDEX "source_kind_idx" ON "source" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "token_alias_uq" ON "token_alias" USING btree ("token_id","target_ref");--> statement-breakpoint
CREATE INDEX "token_alias_target_idx" ON "token_alias" USING btree ("target_token_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_set_system_slug_uq" ON "token_set" USING btree ("design_system_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "token_usage_uq" ON "token_usage" USING btree ("token_id","component_id","property");--> statement-breakpoint
CREATE UNIQUE INDEX "token_set_name_uq" ON "token" USING btree ("token_set_id","name");--> statement-breakpoint
CREATE INDEX "token_system_category_idx" ON "token" USING btree ("design_system_id","category");--> statement-breakpoint
CREATE INDEX "token_name_trgm" ON "token" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "evidence_subject_idx" ON "verification_evidence" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "evidence_system_idx" ON "verification_evidence" USING btree ("design_system_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_dedupe_uq" ON "verification_evidence" USING btree ("subject_type","subject_id","field","source_url","extraction_method");