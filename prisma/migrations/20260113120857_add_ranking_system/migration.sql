-- CreateTable
CREATE TABLE "task_statistics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
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

-- CreateTable
CREATE TABLE "daily_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "positions" INTEGER NOT NULL DEFAULT 0,
    "units" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "pick_time_sec" REAL NOT NULL DEFAULT 0,
    "gap_time_sec" REAL NOT NULL DEFAULT 0,
    "elapsed_time_sec" REAL NOT NULL DEFAULT 0,
    "day_pph" REAL,
    "day_uph" REAL,
    "gap_share" REAL,
    "day_points" REAL NOT NULL DEFAULT 0,
    "daily_rank" INTEGER,
    "avg_efficiency" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "daily_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "monthly_stats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "total_positions" INTEGER NOT NULL DEFAULT 0,
    "total_units" INTEGER NOT NULL DEFAULT 0,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "total_pick_time_sec" REAL NOT NULL DEFAULT 0,
    "month_points" REAL NOT NULL DEFAULT 0,
    "monthly_rank" INTEGER,
    "avg_pph" REAL,
    "avg_uph" REAL,
    "avg_efficiency" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "monthly_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "norms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "warehouse" TEXT,
    "norm_a" REAL NOT NULL,
    "norm_b" REAL NOT NULL,
    "norm_c" REAL NOT NULL,
    "norm_version" TEXT NOT NULL DEFAULT '1.0',
    "effective_from" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "coefficient_k" REAL NOT NULL DEFAULT 0.3,
    "coefficient_m" REAL NOT NULL DEFAULT 3.0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "daily_achievements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "daily_stats_id" TEXT NOT NULL,
    "achievement_type" TEXT NOT NULL,
    "achievement_value" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_achievements_daily_stats_id_fkey" FOREIGN KEY ("daily_stats_id") REFERENCES "daily_stats" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "task_statistics_task_id_key" ON "task_statistics"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_stats_user_id_date_key" ON "daily_stats"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_stats_user_id_year_month_key" ON "monthly_stats"("user_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "norms_warehouse_norm_version_effective_from_key" ON "norms"("warehouse", "norm_version", "effective_from");
