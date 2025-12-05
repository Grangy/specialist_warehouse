-- AlterTable
ALTER TABLE "shipment_tasks" ADD COLUMN "completed_at" DATETIME;
ALTER TABLE "shipment_tasks" ADD COLUMN "time_per_100_items" REAL;
ALTER TABLE "shipment_tasks" ADD COLUMN "total_items" INTEGER;
ALTER TABLE "shipment_tasks" ADD COLUMN "total_units" INTEGER;
