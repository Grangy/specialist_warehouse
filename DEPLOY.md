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

### Аудит производительности и оптимизация

#### Полный аудит (рекомендуется)

```bash
cd /var/www/specialist_warehouse
source ~/.nvm/nvm.sh   # если npm не в PATH
./scripts/run-audit-on-server.sh
```

Создаёт:
- `audit-reports/PERFORMANCE-AUDIT-*.md` — **отчёт в .md** (система, БД, индексы, время запросов, рекомендации)
- `audit-reports/audit-db-load-*.log` — нагрузочный тест за 5 мин

Опции:
```bash
AUDIT_DURATION=600 AUDIT_VERBOSE=1 AUDIT_EXPORT=1 ./scripts/run-audit-on-server.sh
# Только .md отчёт (без нагрузочного теста):
AUDIT_FULL_ONLY=1 ./scripts/run-audit-on-server.sh
```

#### Только нагрузочный тест (вручную)

```bash
npm run audit:db-load -- --duration=600 --verbose --export=audit-reports/audit.json 2>&1 | tee audit-reports/audit.log
```

#### 2. Логирование запросов Next.js → БД

Чтобы увидеть, какие запросы делает приложение и где тормоза:

```bash
# Временно включить логирование (рестарт PM2 с env):
pm2 stop sklad-spec
PRISMA_LOG_QUERIES=1 pm2 start npm --name "sklad-spec" -- start
# Логи пойдут в pm2:
pm2 logs sklad-spec

# Только медленные запросы (>50ms):
PRISMA_LOG_QUERIES=1 PRISMA_LOG_SLOW_MS=50 pm2 start npm --name "sklad-spec" -- start

# Лог в файл (удобно для анализа):
PRISMA_LOG_QUERIES=1 PRISMA_LOG_FILE=/var/www/specialist_warehouse/audit-reports/prisma-queries.log pm2 start npm --name "sklad-spec" -- start
```

**Важно:** после сбора логов — выключить и вернуть обычный запуск:

```bash
pm2 delete sklad-spec
pm2 start npm --name "sklad-spec" -- start
```

#### 3. Где искать тормоза

- `task stats agg` > 100 ms — тяжёлая aggregate по TaskStatistics, проверить индексы
- `shipments count` > 50 ms — много отгрузок, индекс по `deleted`
- Высокий loadavg при нормальной памяти — конкуренция за CPU (poll, API)
- Рост RSS процесса — возможная утечка, перезапуск по расписанию

---

## Откат миграции

SQLite не поддерживает `migrate reset` с сохранением данных. Для отката:

1. Восстановить БД из бэкапа: `cp backups/dev.db.backup.XXXXXXXX prisma/dev.db`
2. Пометить миграцию как откатанную: `npx prisma migrate resolve --rolled-back 20260209120000_add_post_lunch_started_at`
