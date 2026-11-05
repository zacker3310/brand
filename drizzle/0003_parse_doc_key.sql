DROP INDEX "parsed_fragment_uq";--> statement-breakpoint
ALTER TABLE "parsed_fragment" ADD COLUMN "doc_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "parsed_fragment_uq" ON "parsed_fragment" USING btree ("source_document_id","adapter_id","adapter_version","content_hash","doc_key");