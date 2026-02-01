-- CreateTable
CREATE TABLE "sync_touch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "touched_at" DATETIME NOT NULL
);

-- Единственная строка: при любом действии обновляем touched_at
INSERT INTO "sync_touch" ("id", "touched_at") VALUES (1, datetime('now'));
