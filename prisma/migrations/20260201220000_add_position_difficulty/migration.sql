-- CreateTable
CREATE TABLE "position_difficulty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "warehouse" TEXT NOT NULL,
    "task_count" INTEGER NOT NULL DEFAULT 0,
    "sum_sec_per_unit" REAL NOT NULL DEFAULT 0,
    "sum_sec_per_pos" REAL NOT NULL DEFAULT 0,
    "total_units" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "position_difficulty_sku_warehouse_key" UNIQUE ("sku", "warehouse")
);
