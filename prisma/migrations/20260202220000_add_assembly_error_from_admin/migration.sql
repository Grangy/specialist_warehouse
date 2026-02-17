-- AlterTable: источник вызова (checker = СОС при проверке, admin = из админки завершённых заказов)
ALTER TABLE "collector_calls" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'checker';
-- Ошибки проверяльщика (при source=admin: 2 за «за проверку»)
ALTER TABLE "collector_calls" ADD COLUMN "checker_error_count" INTEGER;
-- Дата подтверждения заказа (для «ошибка со сборки от DD.MM.YYYY»)
ALTER TABLE "collector_calls" ADD COLUMN "shipment_confirmed_at" DATETIME;
