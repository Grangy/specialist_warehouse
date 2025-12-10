-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shipment_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipment_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "uom" TEXT NOT NULL,
    "location" TEXT,
    "warehouse" TEXT,
    "collected_qty" INTEGER,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_qty" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "shipment_lines_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shipment_lines" ("checked", "collected_qty", "id", "location", "name", "qty", "shipment_id", "sku", "uom", "warehouse") SELECT "checked", "collected_qty", "id", "location", "name", "qty", "shipment_id", "sku", "uom", "warehouse" FROM "shipment_lines";
DROP TABLE "shipment_lines";
ALTER TABLE "new_shipment_lines" RENAME TO "shipment_lines";
CREATE TABLE "new_shipment_task_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "task_id" TEXT NOT NULL,
    "shipment_line_id" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "collected_qty" INTEGER,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "confirmed_qty" INTEGER,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "shipment_task_lines_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "shipment_tasks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shipment_task_lines_shipment_line_id_fkey" FOREIGN KEY ("shipment_line_id") REFERENCES "shipment_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_shipment_task_lines" ("checked", "collected_qty", "id", "qty", "shipment_line_id", "task_id") SELECT "checked", "collected_qty", "id", "qty", "shipment_line_id", "task_id" FROM "shipment_task_lines";
DROP TABLE "shipment_task_lines";
ALTER TABLE "new_shipment_task_lines" RENAME TO "shipment_task_lines";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
