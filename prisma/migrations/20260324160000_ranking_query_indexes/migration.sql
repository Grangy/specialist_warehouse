-- Ускорение join task_statistics ↔ shipment_tasks по датам (топ, рейтинги, overview)
CREATE INDEX "task_statistics_user_id_idx" ON "task_statistics"("user_id");
CREATE INDEX "task_statistics_role_type_idx" ON "task_statistics"("role_type");
CREATE INDEX "shipment_tasks_completed_at_idx" ON "shipment_tasks"("completed_at");
CREATE INDEX "shipment_tasks_confirmed_at_idx" ON "shipment_tasks"("confirmed_at");
CREATE INDEX "shipment_tasks_dropped_at_idx" ON "shipment_tasks"("dropped_at");
