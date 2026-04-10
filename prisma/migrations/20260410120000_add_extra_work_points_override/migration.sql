-- SQLite: фиксированные баллы за завершённую доп.работу (пересчёт вручную / договорённая ставка)
ALTER TABLE "extra_work_sessions" ADD COLUMN "points_override" REAL;
