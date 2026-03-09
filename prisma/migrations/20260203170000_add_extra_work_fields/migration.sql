-- AlterTable
ALTER TABLE "extra_work_sessions" ADD COLUMN "warehouse" TEXT;
ALTER TABLE "extra_work_sessions" ADD COLUMN "comment" TEXT;
ALTER TABLE "extra_work_sessions" ADD COLUMN "duration_minutes" INTEGER;
ALTER TABLE "extra_work_sessions" ADD COLUMN "lunch_scheduled_for" DATETIME;
