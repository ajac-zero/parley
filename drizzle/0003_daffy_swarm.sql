-- Preserve the previous effective inline behavior for existing agents, then
-- use capability URLs for agents created after this migration.
ALTER TABLE "agents" ADD COLUMN "file_delivery" text DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "file_delivery" SET DEFAULT 'url';
