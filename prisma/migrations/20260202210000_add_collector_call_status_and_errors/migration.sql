-- AlterTable
ALTER TABLE "collector_calls" ADD COLUMN "shipment_line_id" TEXT;
ALTER TABLE "collector_calls" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'new';
ALTER TABLE "collector_calls" ADD COLUMN "error_count" INTEGER;
ALTER TABLE "collector_calls" ADD COLUMN "comment" TEXT;
ALTER TABLE "collector_calls" ADD COLUMN "confirmed_at" DATETIME;
