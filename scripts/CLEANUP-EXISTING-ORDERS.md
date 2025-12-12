# 🧹 Пометка существующих заказов как интегрированных в 1С

## Описание

После первого деплоя endpoint `/api/shipments/sync-1c` все существующие обработанные заказы (`status = 'processed'`) будут возвращаться в ответе как "готовые к выгрузке". 

Чтобы пометить их как уже интегрированные в 1С и исключить из ответа endpoint, нужно выполнить этот скрипт.

## ⚠️ ВАЖНО

- **Сделайте бэкап БД** перед выполнением!
- **Убедитесь, что миграции применены** (`npx prisma migrate deploy`)
- **Проверьте путь к базе данных** в `.env` файле
- Скрипт обновит только заказы со статусом `processed` и `exportedTo1C = false`
- После выполнения только **новые** заказы будут возвращаться в endpoint sync-1c

## 🔍 Перед выполнением проверьте:

```bash
# 1. Проверьте, что база данных существует
ls -la prisma/*.db

# 2. Проверьте переменную окружения
cat .env | grep DATABASE_URL

# 3. Проверьте, что миграции применены
npx prisma migrate status

# 4. Если миграции не применены, примените их
npx prisma migrate deploy
```

---

## 🚀 Выполнение на сервере

### Вариант 1: Через TypeScript скрипт (рекомендуется)

```bash
# Подключитесь к серверу
ssh root@77.222.47.184

# Перейдите в директорию проекта
cd /opt/specialist_warehouse

# Создайте бэкап БД
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S)

# Запустите скрипт
npx tsx scripts/mark-all-processed-as-exported.ts
```

### Вариант 2: Через bash скрипт

```bash
cd /opt/specialist_warehouse
./scripts/mark-all-processed-as-exported.sh
```

### Вариант 3: Напрямую через SQL (самый надежный способ)

**Сначала проверьте путь к базе данных:**
```bash
cd /opt/specialist_warehouse

# Проверьте, где находится база данных
ls -la prisma/*.db
# или
find . -name "*.db" -type f

# Проверьте переменную окружения
cat .env | grep DATABASE_URL
```

**Затем выполните SQL запрос:**
```bash
# Если база данных в prisma/dev.db
sqlite3 prisma/dev.db "UPDATE shipments SET exported_to_1c = 1, exported_to_1c_at = datetime('now') WHERE status = 'processed' AND exported_to_1c = 0;"

# Или если путь другой (узнайте из .env)
sqlite3 /path/to/your/database.db "UPDATE shipments SET exported_to_1c = 1, exported_to_1c_at = datetime('now') WHERE status = 'processed' AND exported_to_1c = 0;"
```

**Проверка результата:**
```bash
sqlite3 prisma/dev.db "SELECT COUNT(*) as total_processed, 
  SUM(CASE WHEN exported_to_1c = 1 THEN 1 ELSE 0 END) as exported
FROM shipments WHERE status = 'processed';"
```

---

## 📊 Что делает скрипт

1. Находит все заказы со статусом `processed` и `exportedTo1C = false`
2. Помечает их как интегрированные:
   - Устанавливает `exportedTo1C = true`
   - Устанавливает `exportedTo1CAt = текущее время`
3. Выводит список обновленных заказов

---

## ✅ Проверка результата

После выполнения скрипта проверьте:

```bash
# Проверка через SQL
sqlite3 prisma/dev.db "SELECT COUNT(*) as total, 
  SUM(CASE WHEN exported_to_1c = 1 THEN 1 ELSE 0 END) as exported,
  SUM(CASE WHEN exported_to_1c = 0 AND status = 'processed' THEN 1 ELSE 0 END) as ready
FROM shipments WHERE status = 'processed';"

# Проверка через API (должен вернуть пустой массив или только новые заказы)
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": []
  }'
```

---

## 🔄 Откат (если нужно)

Если нужно откатить изменения:

```bash
# Восстановить бэкап
cp backups/dev.db.backup.YYYYMMDD_HHMMSS prisma/dev.db

# Или через SQL
sqlite3 prisma/dev.db "UPDATE shipments SET exported_to_1c = 0, exported_to_1c_at = NULL WHERE exported_to_1c = 1;"
```

---

## 📝 Пример вывода скрипта

```
🔄 Начинаем пометку всех обработанных заказов как интегрированных в 1С...

📦 Найдено заказов для пометки: 15

✅ Обновлено заказов: 15

📋 Список обновленных заказов:
  1. РН-000123 (ID: clx1234567890)
  2. РН-000124 (ID: clx0987654321)
  ...

✅ Готово! Все существующие обработанные заказы помечены как интегрированные в 1С.
📝 Теперь только новые заказы будут возвращаться в endpoint sync-1c.
```

---

## 🆘 Если что-то пошло не так

1. **Проверьте бэкап:**
   ```bash
   ls -lh backups/
   ```

2. **Проверьте статус заказов:**
   ```bash
   sqlite3 prisma/dev.db "SELECT number, status, exported_to_1c FROM shipments WHERE status = 'processed' LIMIT 10;"
   ```

3. **Восстановите из бэкапа:**
   ```bash
   cp backups/dev.db.backup.YYYYMMDD_HHMMSS prisma/dev.db
   ```

