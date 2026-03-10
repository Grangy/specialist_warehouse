# Инструкция по деплою

## Быстрый деплой (рекомендуется)

```bash
./deploy.sh
```

Скрипт выполняет: бэкап БД → остановку приложения → `git pull` → `npm install` → **миграции** → `prisma generate` → `npm run build` → перезапуск PM2.

---

## Ручной деплой

### 1. Бэкап базы данных

```bash
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S)
```

### 2. Обновление кода

```bash
git fetch origin
git pull origin main
```

### 3. Зависимости

```bash
npm install
```

### 4. Миграции (обязательно)

```bash
npx prisma migrate deploy
```

Применяет все неприменённые миграции из `prisma/migrations/`.

> ⚠️ **Важно:** Если есть изменения в `schema.prisma`, сначала `migrate deploy`, затем `prisma generate`. Порядок в `deploy.sh` — правильный.

### 5. Регенерация Prisma Client

```bash
npx prisma generate
```

### 6. Сборка

```bash
npm run build
```

### 7. Перезапуск

```bash
pm2 restart sklad-spec
# или при первом запуске:
pm2 start npm --name "sklad-spec" -- start
```

---

## Миграции в этом релизе

| Миграция | Описание |
|----------|----------|
| `20260203160000_add_extra_work_sessions` | Таблица `extra_work_sessions` |
| `20260203170000_add_extra_work_fields` | Поля warehouse, comment, duration_minutes, lunch_scheduled_for |
| `20260203180000_add_completion_type` | completion_type (manual/timer) |
| `20260209120000_add_post_lunch_started_at` | post_lunch_started_at — корректный учёт времени после обеда |

---

## Проверка после деплоя

```bash
pm2 status
pm2 logs sklad-spec --lines 50
```

Проверить работу доп. работы: Админка → вкладка «Доп. работа».

### Проверка производительности (доп. работа)

После деплоя, если нужно убедиться, что «Произв.» считается по 5 рабочим дням:

```bash
npm run recalc:extra-work
```

Аудит расхождений (неделя vs 5 раб.дней):

```bash
npm run audit:extra-work-productivity [имя]
```

### Аудит нагрузки на БД и сервер (5–10 мин)

Для оптимизации — снять показания нагрузки:

```bash
npm run audit:db-load
# 10 минут:
npm run audit:db-load -- --duration=600
# Подробный вывод (каждый сэмпл + временной ряд + SQLite PRAGMA):
npm run audit:db-load -- --verbose
# Экспорт в JSON для анализа:
npm run audit:db-load -- --export=audit.json
# Чаще сэмплы (каждые 5 сек):
npm run audit:db-load -- --interval=5000
```

Выводит: loadavg, память, размер БД, время типичных запросов. По итогу — рекомендации.

---

## Откат миграции

SQLite не поддерживает `migrate reset` с сохранением данных. Для отката:

1. Восстановить БД из бэкапа: `cp backups/dev.db.backup.XXXXXXXX prisma/dev.db`
2. Пометить миграцию как откатанную: `npx prisma migrate resolve --rolled-back 20260209120000_add_post_lunch_started_at`
