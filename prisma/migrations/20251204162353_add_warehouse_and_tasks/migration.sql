-- AlterTable
ALTER TABLE "shipment_lines" ADD COLUMN "warehouse" TEXT;

-- CreateTable
CREATE TABLE "shipment_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipment_id" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collector_name" TEXT,
    CONSTRAINT "shipment_tasks_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shipment_task_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "shipment_line_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "collected_qty" INTEGER,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "shipment_task_lines_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shipment_task_lines_shipment_line_id_fkey" FOREIGN KEY ("shipment_line_id") REFERENCES "shipment_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "shipment_task_locks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "locked_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_task_locks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_task_locks_task_id_key" ON "shipment_task_locks"("task_id");
