-- CreateTable
CREATE TABLE "region_exclusions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "region" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "region_exclusions_region_key" ON "region_exclusions"("region");
