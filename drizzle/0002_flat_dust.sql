-- Attachments are now stored in S3-compatible object storage instead of
-- Postgres. Pre-existing rows have no corresponding object, so they're
-- dropped rather than migrated (greenfield change, no production data).
DELETE FROM "files";--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "storage_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "files" DROP COLUMN "data";
