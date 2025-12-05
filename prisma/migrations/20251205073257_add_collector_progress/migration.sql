-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shipment_tasks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shipment_id" TEXT NOT NULL,
    "warehouse" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collector_name" TEXT,
    "collector_id" TEXT,
    "started_at" DATETIME,
    CONSTRAINT "shipment_tasks_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "shipment_tasks_collector_id_fkey" FOREIGN KEY ("collector_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_shipment_tasks" ("collector_name", "created_at", "id", "shipment_id", "status", "warehouse") SELECT "collector_name", "created_at", "id", "shipment_id", "status", "warehouse" FROM "shipment_tasks";
DROP TABLE "shipment_tasks";
ALTER TABLE "new_shipment_tasks" RENAME TO "shipment_tasks";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
