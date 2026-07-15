-- Честный знак: флаг на позиции + уникальные коды на каждую единицу (qty)
ALTER TABLE "shipment_lines" ADD COLUMN "has_honest_sign" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "shipment_line_honest_sign_codes" (
    "id" TEXT NOT NULL,
    "shipment_line_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unit_index" INTEGER NOT NULL,
    "task_id" TEXT,
    "task_line_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_line_honest_sign_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_line_honest_sign_codes_shipment_line_id_fkey"
      FOREIGN KEY ("shipment_line_id") REFERENCES "shipment_lines" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "shipment_line_honest_sign_codes_code_key"
  ON "shipment_line_honest_sign_codes"("code");

CREATE UNIQUE INDEX "shipment_line_honest_sign_codes_shipment_line_id_unit_index_key"
  ON "shipment_line_honest_sign_codes"("shipment_line_id", "unit_index");

CREATE INDEX "shipment_line_honest_sign_codes_shipment_line_id_idx"
  ON "shipment_line_honest_sign_codes"("shipment_line_id");

CREATE INDEX "shipment_line_honest_sign_codes_task_id_idx"
  ON "shipment_line_honest_sign_codes"("task_id");

CREATE INDEX "shipment_line_honest_sign_codes_task_line_id_idx"
  ON "shipment_line_honest_sign_codes"("task_line_id");
