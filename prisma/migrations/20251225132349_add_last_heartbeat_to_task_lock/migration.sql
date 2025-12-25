-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shipment_task_locks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "locked_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_task_locks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shipment_task_locks" ("id", "locked_at", "task_id", "user_id") SELECT "id", "locked_at", "task_id", "user_id" FROM "shipment_task_locks";
DROP TABLE "shipment_task_locks";
ALTER TABLE "new_shipment_task_locks" RENAME TO "shipment_task_locks";
CREATE UNIQUE INDEX "shipment_task_locks_task_id_key" ON "shipment_task_locks"("task_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
