-- CreateTable
CREATE TABLE "stats_snapshots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cache_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computed_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "stats_snapshots_cache_key_key" ON "stats_snapshots"("cache_key");
