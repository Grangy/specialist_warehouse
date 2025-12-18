# 🔍 Тестирование данных для 1С

## Проблема

При отправке данных в 1С приходят тестовые данные (например, "ООО Ромашка") вместо реальных данных заказов.

## Диагностика

### 1. Запуск тестового скрипта

```bash
# На сервере
cd /opt/specialist_warehouse
npx tsx scripts/test-1c-data.ts
```

Скрипт покажет:
- Какие заказы готовы к выгрузке в 1С
- Какие данные будут отправлены в 1С
- Есть ли тестовые данные в БД
- Детальную информацию по каждому заказу

### 2. Проверка через API

```bash
# Проверка sync-1c endpoint
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}' | jq '.orders[] | {number, customer_name, id}'
```

### 3. Проверка базы данных напрямую

```bash
# Подключение к БД
sqlite3 prisma/dev.db

# Проверка заказов
SELECT id, number, customer_name, status, exported_to_1c 
FROM shipments 
WHERE status = 'processed' 
ORDER BY created_at DESC 
LIMIT 10;

# Проверка на тестовые данные
SELECT id, number, customer_name 
FROM shipments 
WHERE customer_name LIKE '%Ромашка%' 
   OR customer_name LIKE '%Тест%'
   OR number LIKE '%TEST%';
```

## Возможные причины

### 1. Тестовые данные в БД

Если в базе данных есть тестовые заказы, они будут отправляться в 1С.

**Решение:** Удалить или пометить тестовые заказы:
```sql
-- Пометить тестовые заказы как уже выгруженные
UPDATE shipments 
SET exported_to_1c = 1 
WHERE customer_name LIKE '%Ромашка%' 
   OR customer_name LIKE '%Тест%';
```

### 2. Использование моков (маловероятно)

Старые файлы с моками (`mock-data.js`, `src/lib/api/mockData.ts`) не используются в продакшене. Основные endpoints используют Prisma и реальные данные из БД.

**Проверка:** Убедитесь, что endpoints используют Prisma:
- ✅ `src/app/api/shipments/[id]/confirm/route.ts` - использует Prisma
- ✅ `src/app/api/shipments/sync-1c/route.ts` - использует Prisma
- ⚠️ `src/app/api/shipments/[id]/processed/route.ts` - использует моки, но не используется в коде

### 3. Жестко закодированные данные

Проверьте, нет ли где-то жестко закодированных значений:
```bash
# Поиск жестко закодированных данных
grep -r "ООО Ромашка" src/app/api/
grep -r "customer_name.*=" src/app/api/shipments/
```

## Проверка данных перед отправкой в 1С

### Через API sync-1c

```bash
# Получить список готовых заказов
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}' | jq '.orders[] | {
    id,
    number,
    customer_name,
    destination,
    items_count,
    total_qty,
    lines: .lines | length
  }'
```

### Проверка конкретного заказа

```bash
# Получить детальную информацию о заказе
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}' | jq '.orders[] | select(.number == "РН-XXXXXX")'
```

## Решение проблемы

### Шаг 1: Проверка данных в БД

```bash
# На сервере
cd /opt/specialist_warehouse
npx tsx scripts/test-1c-data.ts
```

### Шаг 2: Очистка тестовых данных

Если найдены тестовые заказы:

```sql
-- Вариант 1: Пометить как выгруженные (рекомендуется)
UPDATE shipments 
SET exported_to_1c = 1, 
    exported_to_1c_at = datetime('now')
WHERE customer_name LIKE '%Ромашка%' 
   OR customer_name LIKE '%Тест%'
   OR number LIKE '%TEST%';

-- Вариант 2: Удалить тестовые заказы (осторожно!)
-- DELETE FROM shipments 
-- WHERE customer_name LIKE '%Ромашка%' 
--    OR customer_name LIKE '%Тест%';
```

### Шаг 3: Проверка после очистки

```bash
# Повторный запуск тестового скрипта
npx tsx scripts/test-1c-data.ts

# Проверка через API
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}' | jq '.orders[] | .customer_name'
```

## Логирование

Для отладки включите логирование в коде:

```typescript
// В src/app/api/shipments/sync-1c/route.ts
console.log('[Sync-1C] Формируем данные для заказа:', {
  id: shipment.id,
  number: shipment.number,
  customer_name: shipment.customerName,
  // ...
});
```

Проверьте логи приложения:
```bash
# PM2
pm2 logs sklad-spec

# Systemd
journalctl -u specialist-warehouse -f
```

## Контрольный список

- [ ] Запущен тестовый скрипт `test-1c-data.ts`
- [ ] Проверены данные через API `sync-1c`
- [ ] Проверена БД на наличие тестовых данных
- [ ] Удалены/помечены тестовые заказы
- [ ] Проверены логи приложения
- [ ] Проверено, что новые заказы создаются с правильными данными

## Дополнительная информация

- **Файлы с моками:** `mock-data.js`, `src/lib/api/mockData.ts` - не используются в продакшене
- **Основные endpoints:** Используют Prisma и реальные данные из БД
- **Старый endpoint:** `src/app/api/shipments/[id]/processed/route.ts` - не используется, можно удалить

