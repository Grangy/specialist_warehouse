-- CreateTable
CREATE TABLE "collector_calls" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "line_index" INTEGER NOT NULL,
    "collector_id" TEXT NOT NULL,
    "checker_id" TEXT NOT NULL,
    "called_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collector_calls_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collector_calls_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "collector_calls_checker_id_fkey" FOREIGN KEY ("checker_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "collector_calls_task_id_idx" ON "collector_calls"("task_id");
CREATE INDEX "collector_calls_collector_id_idx" ON "collector_calls"("collector_id");
CREATE INDEX "collector_calls_checker_id_idx" ON "collector_calls"("checker_id");
CREATE INDEX "collector_calls_called_at_idx" ON "collector_calls"("called_at");
