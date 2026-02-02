-- CreateTable
CREATE TABLE "temporary_region_priorities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "temporary_region_priorities_date_region_key" ON "temporary_region_priorities"("date", "region");
