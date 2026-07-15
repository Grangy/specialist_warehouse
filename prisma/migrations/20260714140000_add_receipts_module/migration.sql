-- Роль receiver: users.role уже TEXT, значение enum не требует ALTER.
SELECT 1;

-- Документы приёмки
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "external_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "warehouse" TEXT,
    "supplier_name" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "document_date" DATETIME,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "receiver_id" TEXT,
    "planned_items_count" INTEGER NOT NULL DEFAULT 0,
    "planned_units_count" INTEGER NOT NULL DEFAULT 0,
    "actual_units_count" INTEGER NOT NULL DEFAULT 0,
    "comment" TEXT NOT NULL DEFAULT '',
    "points_awarded" REAL,
    "exported_to_1c" BOOLEAN NOT NULL DEFAULT false,
    "exported_to_1c_at" DATETIME,
    "last_sent_to_1c_at" DATETIME,
    "sync_error" TEXT,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" DATETIME,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipts_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "receipts_external_id_key" ON "receipts"("external_id");
CREATE INDEX "receipts_status_deleted_idx" ON "receipts"("status", "deleted");
CREATE INDEX "receipts_number_idx" ON "receipts"("number");
CREATE INDEX "receipts_receiver_id_idx" ON "receipts"("receiver_id");
CREATE INDEX "receipts_exported_to_1c_status_idx" ON "receipts"("exported_to_1c", "status");

CREATE TABLE "receipt_lines" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receipt_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "art" TEXT,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "uom" TEXT NOT NULL DEFAULT 'шт',
    "planned_qty" INTEGER NOT NULL,
    "actual_qty" INTEGER,
    "discrepancy_qty" INTEGER NOT NULL DEFAULT 0,
    "requires_marking_scan" BOOLEAN NOT NULL DEFAULT false,
    "checked" BOOLEAN NOT NULL DEFAULT false,
    "line_comment" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "receipt_lines_receipt_id_idx" ON "receipt_lines"("receipt_id");
CREATE INDEX "receipt_lines_sku_idx" ON "receipt_lines"("sku");

CREATE TABLE "receipt_expected_marking_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receipt_line_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit_index" INTEGER NOT NULL,
    CONSTRAINT "receipt_expected_marking_codes_receipt_line_id_fkey"
      FOREIGN KEY ("receipt_line_id") REFERENCES "receipt_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "receipt_expected_marking_codes_code_key" ON "receipt_expected_marking_codes"("code");
CREATE UNIQUE INDEX "receipt_expected_marking_codes_receipt_line_id_unit_index_key"
  ON "receipt_expected_marking_codes"("receipt_line_id", "unit_index");
CREATE INDEX "receipt_expected_marking_codes_receipt_line_id_idx" ON "receipt_expected_marking_codes"("receipt_line_id");

CREATE TABLE "receipt_scanned_marking_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receipt_line_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "scanned_by_id" TEXT,
    "scanned_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "receipt_scanned_marking_codes_receipt_line_id_fkey"
      FOREIGN KEY ("receipt_line_id") REFERENCES "receipt_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "receipt_scanned_marking_codes_receipt_line_id_idx" ON "receipt_scanned_marking_codes"("receipt_line_id");
CREATE INDEX "receipt_scanned_marking_codes_code_idx" ON "receipt_scanned_marking_codes"("code");

CREATE TABLE "receipt_discrepancies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receipt_id" TEXT NOT NULL,
    "receipt_line_id" TEXT,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "comment" TEXT,
    "scanned_code" TEXT,
    "user_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipt_discrepancies_receipt_id_fkey"
      FOREIGN KEY ("receipt_id") REFERENCES "receipts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "receipt_discrepancies_receipt_line_id_fkey"
      FOREIGN KEY ("receipt_line_id") REFERENCES "receipt_lines" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "receipt_discrepancies_receipt_id_idx" ON "receipt_discrepancies"("receipt_id");

CREATE TABLE "receipt_audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "receipt_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "receipt_audit_logs_receipt_id_fkey"
      FOREIGN KEY ("receipt_id") REFERENCES "receipts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "receipt_audit_logs_receipt_id_created_at_idx" ON "receipt_audit_logs"("receipt_id", "created_at");
