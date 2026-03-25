-- Composite index for user-scoped ranking queries (user_id + role_type + join on task dates)
CREATE INDEX "task_statistics_user_id_role_type_idx" ON "task_statistics"("user_id", "role_type");

-- Dictator leaderboard: filter by dictator_id + confirmed_at range
CREATE INDEX "shipment_tasks_dictator_id_confirmed_at_idx" ON "shipment_tasks"("dictator_id", "confirmed_at");
