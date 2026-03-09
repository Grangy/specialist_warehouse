-- CreateTable
CREATE TABLE "extra_work_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "assigned_by_id" TEXT NOT NULL,
    "started_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'running',
    "lunch_slot" TEXT,
    "lunch_started_at" DATETIME,
    "lunch_ends_at" DATETIME,
    "elapsed_sec_before_lunch" REAL NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "extra_work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "extra_work_sessions_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
