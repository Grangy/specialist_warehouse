# Примеры curl запросов для создания кастомного заказа

## 🆕 Авторизация в запросе (рекомендуется для внешних систем)

Теперь можно передавать `login` и `password` прямо в теле запроса создания заказа:

```bash
curl -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "number": "РН-20250115-001",
    "customerName": "ООО Моя Компания",
    "destination": "Основной склад",
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Мой товар 1",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-002",
        "name": "Мой товар 2",
        "qty": 5,
        "uom": "шт",
        "location": "Стеллаж B / Полка 2",
        "warehouse": "Склад 1"
      }
    ]
  }'
```

## Авторизация через cookies (старый способ)

```bash
# 1. Авторизация
curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# 2. Создание заказа
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-20250115-001",
    "customerName": "ООО Моя Компания",
    "destination": "Основной склад",
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Мой товар 1",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-002",
        "name": "Мой товар 2",
        "qty": 5,
        "uom": "шт",
        "location": "Стеллаж B / Полка 2",
        "warehouse": "Склад 1"
      }
    ]
  }'
```

## Полный пример со всеми полями

```bash
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-20250115-001",
    "customerName": "ООО Моя Компания",
    "destination": "Основной склад / Рампа 3",
    "itemsCount": 5,
    "totalQty": 45,
    "weight": 250.5,
    "comment": "Срочный заказ для клиента",
    "businessRegion": "Москва",
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Товар номер один",
        "qty": 15,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-002",
        "name": "Товар номер два",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 2",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-003",
        "name": "Товар номер три",
        "qty": 8,
        "uom": "шт",
        "location": "Стеллаж B / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "SKU-004",
        "name": "Товар номер четыре",
        "qty": 7,
        "uom": "шт",
        "location": "Стеллаж B / Полка 2",
        "warehouse": "Склад 2"
      },
      {
        "sku": "SKU-005",
        "name": "Товар номер пять",
        "qty": 5,
        "uom": "шт",
        "location": "Стеллаж C / Полка 1",
        "warehouse": "Склад 2"
      }
    ]
  }'
```

## Пример с большим количеством товаров

```bash
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-BIG-ORDER-001",
    "customerName": "ООО Крупный Клиент",
    "destination": "Основной склад",
    "businessRegion": "Санкт-Петербург",
    "comment": "Большой заказ на 20 позиций",
    "lines": [
      {"sku": "ITEM-001", "name": "Товар 1", "qty": 12, "uom": "шт", "location": "Стеллаж A1 / Полка 1", "warehouse": "Склад 1"},
      {"sku": "ITEM-002", "name": "Товар 2", "qty": 8, "uom": "шт", "location": "Стеллаж A1 / Полка 2", "warehouse": "Склад 1"},
      {"sku": "ITEM-003", "name": "Товар 3", "qty": 15, "uom": "шт", "location": "Стеллаж A2 / Полка 1", "warehouse": "Склад 1"},
      {"sku": "ITEM-004", "name": "Товар 4", "qty": 6, "uom": "шт", "location": "Стеллаж A2 / Полка 2", "warehouse": "Склад 1"},
      {"sku": "ITEM-005", "name": "Товар 5", "qty": 10, "uom": "шт", "location": "Стеллаж B1 / Полка 1", "warehouse": "Склад 1"},
      {"sku": "ITEM-006", "name": "Товар 6", "qty": 9, "uom": "шт", "location": "Стеллаж B1 / Полка 2", "warehouse": "Склад 1"},
      {"sku": "ITEM-007", "name": "Товар 7", "qty": 7, "uom": "шт", "location": "Стеллаж B2 / Полка 1", "warehouse": "Склад 1"},
      {"sku": "ITEM-008", "name": "Товар 8", "qty": 11, "uom": "шт", "location": "Стеллаж B2 / Полка 2", "warehouse": "Склад 1"},
      {"sku": "ITEM-009", "name": "Товар 9", "qty": 5, "uom": "шт", "location": "Стеллаж C1 / Полка 1", "warehouse": "Склад 2"},
      {"sku": "ITEM-010", "name": "Товар 10", "qty": 13, "uom": "шт", "location": "Стеллаж C1 / Полка 2", "warehouse": "Склад 2"},
      {"sku": "ITEM-011", "name": "Товар 11", "qty": 4, "uom": "шт", "location": "Стеллаж C2 / Полка 1", "warehouse": "Склад 2"},
      {"sku": "ITEM-012", "name": "Товар 12", "qty": 8, "uom": "шт", "location": "Стеллаж C2 / Полка 2", "warehouse": "Склад 2"},
      {"sku": "ITEM-013", "name": "Товар 13", "qty": 6, "uom": "шт", "location": "Стеллаж D1 / Полка 1", "warehouse": "Склад 2"},
      {"sku": "ITEM-014", "name": "Товар 14", "qty": 9, "uom": "шт", "location": "Стеллаж D1 / Полка 2", "warehouse": "Склад 2"},
      {"sku": "ITEM-015", "name": "Товар 15", "qty": 7, "uom": "шт", "location": "Стеллаж D2 / Полка 1", "warehouse": "Склад 2"},
      {"sku": "ITEM-016", "name": "Товар 16", "qty": 10, "uom": "шт", "location": "Стеллаж D2 / Полка 2", "warehouse": "Склад 2"},
      {"sku": "ITEM-017", "name": "Товар 17", "qty": 5, "uom": "шт", "location": "Стеллаж E1 / Полка 1", "warehouse": "Склад 3"},
      {"sku": "ITEM-018", "name": "Товар 18", "qty": 8, "uom": "шт", "location": "Стеллаж E1 / Полка 2", "warehouse": "Склад 3"},
      {"sku": "ITEM-019", "name": "Товар 19", "qty": 6, "uom": "шт", "location": "Стеллаж E2 / Полка 1", "warehouse": "Склад 3"},
      {"sku": "ITEM-020", "name": "Товар 20", "qty": 11, "uom": "шт", "location": "Стеллаж E2 / Полка 2", "warehouse": "Склад 3"}
    ]
  }'
```

## Использование переменных окружения

```bash
# Установите переменные
export BASE_URL="http://localhost:3000"
export ORDER_NUMBER="РН-$(date +%Y%m%d-%H%M%S)"
export CUSTOMER_NAME="ООО Моя Компания"
export BUSINESS_REGION="Москва"

# Авторизация
curl -c /tmp/cookies.txt -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"login\":\"admin\",\"password\":\"admin123\"}"

# Создание заказа
curl -b /tmp/cookies.txt -X POST "${BASE_URL}/api/shipments" \
  -H "Content-Type: application/json" \
  -d "{
    \"number\": \"${ORDER_NUMBER}\",
    \"customerName\": \"${CUSTOMER_NAME}\",
    \"destination\": \"Основной склад\",
    \"businessRegion\": \"${BUSINESS_REGION}\",
    \"lines\": [
      {
        \"sku\": \"SKU-001\",
        \"name\": \"Мой товар\",
        \"qty\": 10,
        \"uom\": \"шт\",
        \"location\": \"Стеллаж A / Полка 1\",
        \"warehouse\": \"Склад 1\"
      }
    ]
  }"
```

## Использование JSON файла

Создайте файл `order.json`:

```json
{
  "number": "РН-20250115-001",
  "customerName": "ООО Моя Компания",
  "destination": "Основной склад",
  "itemsCount": 3,
  "totalQty": 25,
  "weight": 150.5,
  "comment": "Заказ из JSON файла",
  "businessRegion": "Москва",
  "lines": [
    {
      "sku": "SKU-001",
      "name": "Товар 1",
      "qty": 10,
      "uom": "шт",
      "location": "Стеллаж A / Полка 1",
      "warehouse": "Склад 1"
    },
    {
      "sku": "SKU-002",
      "name": "Товар 2",
      "qty": 8,
      "uom": "шт",
      "location": "Стеллаж B / Полка 2",
      "warehouse": "Склад 1"
    },
    {
      "sku": "SKU-003",
      "name": "Товар 3",
      "qty": 7,
      "uom": "шт",
      "location": "Стеллаж C / Полка 3",
      "warehouse": "Склад 2"
    }
  ]
}
```

Затем используйте:

```bash
# Авторизация
curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# Создание заказа из файла
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d @order.json
```

## Для production сервера

```bash
BASE_URL="https://sklad.specialist82.pro"

# Авторизация
curl -c /tmp/cookies.txt -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# Создание заказа
curl -b /tmp/cookies.txt -X POST "${BASE_URL}/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-PROD-001",
    "customerName": "ООО Клиент",
    "destination": "Основной склад",
    "businessRegion": "Москва",
    "lines": [
      {
        "sku": "PROD-001",
        "name": "Продукт 1",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      }
    ]
  }'
```

## Структура данных

### Обязательные поля:
- `number` - номер заказа (строка, уникальный)
- `customerName` - название клиента (строка)
- `destination` - место назначения (строка)
- `lines` - массив товаров (минимум 1 товар)

### Опциональные поля:
- `itemsCount` - количество наименований (число, вычисляется автоматически)
- `totalQty` - общее количество товара (число, вычисляется автоматически)
- `weight` - вес заказа в кг (число)
- `comment` - комментарий (строка)
- `businessRegion` - бизнес-регион (строка)

### Структура товара (lines):
- `sku` - артикул товара (строка)
- `name` - название товара (строка)
- `qty` - количество (число)
- `uom` - единица измерения (строка, по умолчанию "шт")
- `location` - местоположение на складе (строка или null)
- `warehouse` - склад (строка или null)

## Примечания

1. **Автоматический расчет**: Если не указать `itemsCount` и `totalQty`, они будут вычислены автоматически из массива `lines`.

2. **Разбиение на задания**: Заказ автоматически разбивается на задания по складам (максимум 35 наименований на задание).

3. **Уникальность номера**: Если заказ с таким номером уже существует, старый заказ будет удален и создан новый.

4. **Статус позиций**: Все позиции создаются с непроверенным статусом (`checked: false`, `collectedQty: null`).



