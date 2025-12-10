# API Авторизация в запросе создания заказа

API создания заказа (`POST /api/shipments`) теперь поддерживает авторизацию напрямую в теле запроса, без необходимости использования cookies.

## Два способа авторизации

### 1. Авторизация в теле запроса (рекомендуется для внешних систем)

Передайте `login` и `password` в теле запроса вместе с данными заказа:

```bash
curl -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "number": "РН-000123",
    "customerName": "ООО Компания",
    "destination": "Основной склад",
    "businessRegion": "Москва",
    "comment": "Заказ из 1С",
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Товар 1",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      }
    ]
  }'
```

### 2. Авторизация через cookies (для веб-интерфейса)

Сначала авторизуйтесь через `/api/auth/login`, затем используйте cookies:

```bash
# Шаг 1: Авторизация
curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login": "admin", "password": "admin123"}'

# Шаг 2: Создание заказа (без login/password в теле)
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-000123",
    "customerName": "ООО Компания",
    "destination": "Основной склад",
    "lines": [...]
  }'
```

## Структура запроса

### Обязательные поля

- `number` - номер заказа (уникальный)
- `customerName` - название клиента
- `destination` - место назначения
- `lines` - массив позиций заказа (минимум 1 позиция)

### Поля авторизации (опционально, если не используете cookies)

- `login` - логин пользователя с ролью `admin`
- `password` - пароль пользователя

### Опциональные поля

- `itemsCount` - количество позиций (автоматически вычисляется из `lines`)
- `totalQty` - общее количество (автоматически вычисляется из `lines`)
- `weight` - вес заказа
- `comment` - комментарий
- `businessRegion` - бизнес-регион

### Структура позиции заказа (lines)

```json
{
  "sku": "SKU-001",           // Артикул (обязательно)
  "name": "Название товара",  // Название (обязательно)
  "qty": 10,                  // Количество (обязательно)
  "uom": "шт",                // Единица измерения (обязательно)
  "location": "Стеллаж A",    // Место хранения (опционально)
  "warehouse": "Склад 1"      // Склад (опционально)
}
```

## Примеры ответов

### Успешное создание заказа

```json
{
  "success": true,
  "message": "Заказ успешно создан и разбит на 2 заданий",
  "shipment": {
    "id": "clx123...",
    "number": "РН-000123",
    "created_at": "2025-01-15T10:00:00.000Z",
    "customer_name": "ООО Компания",
    "status": "new",
    "tasks_count": 2,
    "lines": [...],
    "tasks": [...]
  }
}
```

### Ошибка авторизации

```json
{
  "error": "Неверный логин или пароль"
}
```

### Ошибка прав доступа

```json
{
  "error": "Недостаточно прав доступа. Требуется роль admin"
}
```

### Ошибка валидации

```json
{
  "error": "Необходимо указать: number, customerName, destination, lines"
}
```

## Использование в 1С

Для интеграции с 1С используйте первый способ (авторизация в теле запроса):

```http
POST /api/shipments HTTP/1.1
Host: your-server.com
Content-Type: application/json

{
  "login": "your_admin_login",
  "password": "your_admin_password",
  "number": "РН-000123",
  "customerName": "ООО Клиент",
  "destination": "Склад 1",
  "businessRegion": "Москва",
  "lines": [
    {
      "sku": "12345",
      "name": "Товар",
      "qty": 5,
      "uom": "шт",
      "location": "А-1-2",
      "warehouse": "Склад 1"
    }
  ]
}
```

## Безопасность

⚠️ **Важно**: При использовании авторизации в теле запроса:
- Используйте HTTPS для защиты паролей
- Храните credentials в безопасном месте
- Не логируйте пароли в открытом виде
- Используйте отдельного пользователя с минимальными правами для API

## Обратная совместимость

API полностью обратно совместим:
- Если переданы `login` и `password` - используется авторизация в запросе
- Если не переданы - используется авторизация через cookies (как раньше)

