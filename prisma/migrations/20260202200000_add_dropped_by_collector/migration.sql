-- AlterTable
ALTER TABLE "shipment_tasks" ADD COLUMN "dropped_by_collector_id" TEXT;
ALTER TABLE "shipment_tasks" ADD COLUMN "dropped_by_collector_name" TEXT;
ALTER TABLE "shipment_tasks" ADD COLUMN "dropped_at" DATETIME;
