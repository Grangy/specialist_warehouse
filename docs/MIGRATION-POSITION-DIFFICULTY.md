# Миграция: PositionDifficulty (сложность позиций)

## Команды для применения миграции

### Обычный случай (история миграций совпадает с БД)

На сервере или после клонирования репозитория:

```bash
# 1. Установить зависимости (если ещё не установлены)
npm install

# 2. Применить все неприменённые миграции
npx prisma migrate deploy
```

Миграция `20260201220000_add_position_difficulty` создаст таблицу `position_difficulty`.

### Сгенерировать Prisma Client после миграции

```bash
npx prisma generate
```

Обычно это уже делается при `migrate deploy`; отдельно нужно, если правили `schema.prisma` без миграции.

### Если есть расхождение истории миграций (drift)

Если при `prisma migrate deploy` появляется ошибка про drift или отсутствующие миграции:

**Вариант A — только добавить новую таблицу вручную (без сброса БД):**

```bash
# SQLite
sqlite3 prisma/dev.db < prisma/migrations/20260201220000_add_position_difficulty/migration.sql
```

Или выполнить содержимое файла вручную в своём клиенте БД.

**Вариант B — пометить миграцию как применённую (если таблица уже создана):**

```bash
npx prisma migrate resolve --applied 20260201220000_add_position_difficulty
```

### Проверка

После применения миграции таблица должна существовать:

```bash
# SQLite
sqlite3 prisma/dev.db ".schema position_difficulty"
```

Ожидаются колонки: `id`, `sku`, `name`, `warehouse`, `task_count`, `sum_sec_per_unit`, `sum_sec_per_pos`, `total_units`, `updated_at`, уникальный ключ `(sku, warehouse)`.
