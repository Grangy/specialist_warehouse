-- AlterTable
ALTER TABLE "region_priorities" ADD COLUMN "priority_friday" INTEGER DEFAULT 0;
ALTER TABLE "region_priorities" ADD COLUMN "priority_monday" INTEGER DEFAULT 0;
ALTER TABLE "region_priorities" ADD COLUMN "priority_thursday" INTEGER DEFAULT 0;
ALTER TABLE "region_priorities" ADD COLUMN "priority_tuesday" INTEGER DEFAULT 0;
ALTER TABLE "region_priorities" ADD COLUMN "priority_wednesday" INTEGER DEFAULT 0;
