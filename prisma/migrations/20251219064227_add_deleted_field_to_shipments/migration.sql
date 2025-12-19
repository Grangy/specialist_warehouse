-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_shipments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "items_count" INTEGER NOT NULL,
    "total_qty" INTEGER NOT NULL,
    "weight" REAL,
    "comment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'new',
    "business_region" TEXT,
    "collector_name" TEXT,
    "confirmed_at" DATETIME,
    "exported_to_1c" BOOLEAN NOT NULL DEFAULT false,
    "exported_to_1c_at" DATETIME,
    "places" INTEGER,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" DATETIME
);
INSERT INTO "new_shipments" ("business_region", "collector_name", "comment", "confirmed_at", "created_at", "customer_name", "destination", "exported_to_1c", "exported_to_1c_at", "id", "items_count", "number", "places", "status", "total_qty", "weight") SELECT "business_region", "collector_name", "comment", "confirmed_at", "created_at", "customer_name", "destination", "exported_to_1c", "exported_to_1c_at", "id", "items_count", "number", "places", "status", "total_qty", "weight" FROM "shipments";
DROP TABLE "shipments";
ALTER TABLE "new_shipments" RENAME TO "shipments";
CREATE UNIQUE INDEX "shipments_number_key" ON "shipments"("number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
