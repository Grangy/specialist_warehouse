# 🔧 Решение проблем со скриптом пометки заказов

## Ошибка: "The table `main.shipments` does not exist"

Эта ошибка означает, что таблица не существует в базе данных. Возможные причины:

### 1. Миграции не применены

**Решение:**
```bash
cd /opt/specialist_warehouse

# Проверьте статус миграций
npx prisma migrate status

# Если есть непримененные миграции, примените их
npx prisma migrate deploy

# Регенерируйте Prisma Client
npx prisma generate
```

### 2. База данных находится в другом месте

**Решение:**
```bash
# Проверьте переменную окружения
cat .env | grep DATABASE_URL

# Проверьте, где реально находится база данных
find . -name "*.db" -type f

# Если база данных в другом месте, обновите .env файл
# или используйте SQL вариант напрямую
```

### 3. База данных не инициализирована

**Решение:**
```bash
# Примените все миграции с нуля
npx prisma migrate deploy

# Или создайте базу данных заново (ОСТОРОЖНО: удалит данные!)
npx prisma migrate reset
```

---

## ✅ Рекомендуемый порядок действий на сервере

```bash
# 1. Подключитесь к серверу
ssh root@77.222.47.184
cd /opt/specialist_warehouse

# 2. Создайте бэкап БД
mkdir -p backups
find . -name "*.db" -exec cp {} backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) \;

# 3. Проверьте переменную окружения
cat .env | grep DATABASE_URL

# 4. Проверьте статус миграций
npx prisma migrate status

# 5. Если нужно, примените миграции
npx prisma migrate deploy
npx prisma generate

# 6. Проверьте существование таблиц
sqlite3 prisma/dev.db ".tables"

# 7. Если таблицы есть, запустите скрипт
npx tsx scripts/mark-all-processed-as-exported.ts

# 8. Если скрипт не работает, используйте SQL напрямую
sqlite3 prisma/dev.db "UPDATE shipments SET exported_to_1c = 1, exported_to_1c_at = datetime('now') WHERE status = 'processed' AND exported_to_1c = 0;"
```

---

## 🔍 Диагностика

### Проверка структуры базы данных

```bash
# Список всех таблиц
sqlite3 prisma/dev.db ".tables"

# Структура таблицы shipments
sqlite3 prisma/dev.db ".schema shipments"

# Количество записей
sqlite3 prisma/dev.db "SELECT COUNT(*) FROM shipments;"
```

### Проверка миграций

```bash
# Статус миграций
npx prisma migrate status

# Список всех миграций
ls -la prisma/migrations/

# Проверка последней миграции
cat prisma/migrations/$(ls -t prisma/migrations/ | head -1)/migration.sql
```

### Проверка Prisma Client

```bash
# Регенерируйте Prisma Client
npx prisma generate

# Проверьте, что клиент сгенерирован
ls -la src/generated/prisma/
```

---

## 🚨 Если ничего не помогает

Используйте SQL напрямую - это самый надежный способ:

```bash
# 1. Найдите базу данных
find . -name "*.db" -type f

# 2. Выполните SQL запрос напрямую
sqlite3 /path/to/your/database.db <<EOF
-- Проверка существования таблицы
SELECT name FROM sqlite_master WHERE type='table' AND name='shipments';

-- Если таблица существует, обновите записи
UPDATE shipments 
SET exported_to_1c = 1, 
    exported_to_1c_at = datetime('now') 
WHERE status = 'processed' 
  AND exported_to_1c = 0;

-- Проверка результата
SELECT COUNT(*) as total_processed,
       SUM(CASE WHEN exported_to_1c = 1 THEN 1 ELSE 0 END) as exported
FROM shipments 
WHERE status = 'processed';
EOF
```

---

## 📞 Дополнительная помощь

Если проблема не решена:
1. Проверьте логи приложения: `pm2 logs sklad-spec`
2. Проверьте, что приложение использует правильную БД
3. Убедитесь, что все миграции применены
4. Проверьте права доступа к файлу БД: `ls -la prisma/*.db`

