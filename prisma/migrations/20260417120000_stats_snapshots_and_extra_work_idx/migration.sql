-- Снимки aggregateRankings для /top без тяжёлого пересчёта в HTTP-запросе
CREATE TABLE IF NOT EXISTS "stats_snapshots" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "computed_at" TEXT NOT NULL,
    CONSTRAINT "stats_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stats_snapshots_cache_key_key" ON "stats_snapshots"("cache_key");

-- Список сессий доп.работы: status + stopped_at (месячные выборки)
CREATE INDEX IF NOT EXISTS "idx_extra_work_sessions_status_stopped_at" ON "extra_work_sessions"("status", "stopped_at");
