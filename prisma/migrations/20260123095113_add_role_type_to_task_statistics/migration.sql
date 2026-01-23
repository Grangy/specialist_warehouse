-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_task_statistics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_type" TEXT NOT NULL DEFAULT 'collector',
    "shipment_id" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "task_time_sec" REAL NOT NULL,
    "pick_time_sec" REAL,
    "elapsed_time_sec" REAL,
    "gap_time_sec" REAL,
    "positions" INTEGER NOT NULL,
    "units" INTEGER NOT NULL,
    "pph" REAL,
    "uph" REAL,
    "sec_per_pos" REAL,
    "sec_per_unit" REAL,
    "units_per_pos" REAL,
    "warehouses_count" INTEGER NOT NULL DEFAULT 1,
    "switches" INTEGER NOT NULL DEFAULT 0,
    "density" REAL,
    "expected_time_sec" REAL,
    "efficiency" REAL,
    "efficiency_clamped" REAL,
    "base_points" REAL,
    "order_points" REAL,
    "norm_a" REAL,
    "norm_b" REAL,
    "norm_c" REAL,
    "norm_version" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "task_statistics_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "task_statistics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_task_statistics" ("base_points", "created_at", "density", "efficiency", "efficiency_clamped", "elapsed_time_sec", "expected_time_sec", "gap_time_sec", "id", "norm_a", "norm_b", "norm_c", "norm_version", "order_points", "pick_time_sec", "positions", "pph", "sec_per_pos", "sec_per_unit", "shipment_id", "switches", "task_id", "task_time_sec", "units", "units_per_pos", "updated_at", "uph", "user_id", "warehouse", "warehouses_count") SELECT "base_points", "created_at", "density", "efficiency", "efficiency_clamped", "elapsed_time_sec", "expected_time_sec", "gap_time_sec", "id", "norm_a", "norm_b", "norm_c", "norm_version", "order_points", "pick_time_sec", "positions", "pph", "sec_per_pos", "sec_per_unit", "shipment_id", "switches", "task_id", "task_time_sec", "units", "units_per_pos", "updated_at", "uph", "user_id", "warehouse", "warehouses_count" FROM "task_statistics";
DROP TABLE "task_statistics";
ALTER TABLE "new_task_statistics" RENAME TO "task_statistics";
CREATE UNIQUE INDEX "task_statistics_task_id_user_id_role_type_key" ON "task_statistics"("task_id", "user_id", "role_type");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
