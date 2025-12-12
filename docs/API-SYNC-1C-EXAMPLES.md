# Примеры запросов к API синхронизации с 1С

## 🌐 Сервер: `http://77.222.47.184:3000`

---

## 📤 Пример 1: Запрос готовых заказов (без обновления статусов)

Если 1С просто хочет получить список готовых заказов, передайте пустой массив:

**С авторизацией через логин/пароль в теле запроса:**

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": []
  }'
```

**С авторизацией через заголовки:**

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{"orders": []}'
```

**Ответ:**
```json
{
  "orders": [
    {
      "id": "clx1234567890",
      "number": "РН-000123",
      "customer_name": "ООО Ромашка",
      "destination": "Основной склад / Рампа 3",
      "status": "processed",
      "business_region": "Москва",
      "comment": "Комментарий к заказу",
      "places": 5,
      "created_at": "2025-01-15T10:15:00.000Z",
      "confirmed_at": "2025-01-15T12:30:00.000Z",
      "processed_at": "2025-01-15T12:30:00.000Z",
      "tasks_count": 3,
      "items_count": 12,
      "total_qty": 57,
      "weight": 245.5,
      "lines": [...],
      "tasks": [...]
    }
  ]
}
```

---

## 📤 Пример 2: Обновление статусов + получение новых заказов

1С обработала заказы и сообщает результаты, одновременно запрашивая новые:

**С авторизацией через логин/пароль в теле запроса (рекомендуется):**

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": [
      {
        "id": "clx1234567890",
        "success": true
      },
      {
        "id": "clx0987654321",
        "success": false
      }
    ]
  }'
```

**С авторизацией через заголовки:**

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "orders": [
      {
        "id": "clx1234567890",
        "success": true
      },
      {
        "id": "clx0987654321",
        "success": false
      }
    ]
  }'
```

**Что происходит:**
- Заказ `clx1234567890` помечается как успешно обработанный в 1С (`exportedTo1C = true`)
- Заказ `clx0987654321` остается в списке готовых (так как `success: false`)
- В ответе возвращаются все готовые заказы (включая те, что еще не были обработаны)

---

## 📤 Пример 3: Только обновление статусов (без получения новых)

Если нужно только обновить статусы без получения новых заказов:

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": [
      {
        "id": "clx1111111111",
        "success": true
      },
      {
        "id": "clx2222222222",
        "success": true
      }
    ]
  }'
```

**Ответ:**
```json
{
  "orders": []
}
```
(Если все заказы уже обработаны, массив будет пустым)

---

## 🔐 Пример с авторизацией через Cookie

Если у вас есть сессия, используйте Cookie:

```bash
# Сначала авторизуйтесь
curl -X POST http://77.222.47.184:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "login": "admin",
    "password": "your_password"
  }'

# Затем используйте сохраненные cookies
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "orders": []
  }'
```

---

## 🔐 Пример с авторизацией в теле запроса

Если 1С не может использовать cookies, можно передать авторизацию в заголовках:

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_token" \
  -d '{
    "orders": [
      {
        "id": "clx1234567890",
        "success": true
      }
    ]
  }'
```

**Примечание:** Текущая реализация использует cookie-based auth. Если нужна авторизация через заголовки, это нужно добавить отдельно.

---

## 📝 JavaScript/TypeScript пример

**С авторизацией через логин/пароль (рекомендуется для 1С):**

```javascript
async function syncWith1C() {
  const response = await fetch('http://77.222.47.184:3000/api/shipments/sync-1c', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      login: 'admin',
      password: 'admin123',
      orders: [
        { id: 'clx1234567890', success: true },
        { id: 'clx0987654321', success: false },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  console.log('Готовые заказы:', data.orders);
  return data.orders;
}
```

**С авторизацией через заголовки:**

```javascript
async function syncWith1C() {
  const response = await fetch('http://77.222.47.184:3000/api/shipments/sync-1c', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Login': 'admin',
      'X-Password': 'admin123',
    },
    body: JSON.stringify({
      orders: [
        { id: 'clx1234567890', success: true },
        { id: 'clx0987654321', success: false },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  console.log('Готовые заказы:', data.orders);
  return data.orders;
}
```

// Использование
syncWith1C()
  .then(orders => {
    console.log(`Получено ${orders.length} готовых заказов`);
    // Обработать заказы в 1С
  })
  .catch(error => {
    console.error('Ошибка синхронизации:', error);
  });
```

---

## 📝 Python пример

**С авторизацией через логин/пароль (рекомендуется для 1С):**

```python
import requests
import json

# URL сервера
url = "http://77.222.47.184:3000/api/shipments/sync-1c"

# Данные для отправки (с логином и паролем)
data = {
    "login": "admin",
    "password": "admin123",
    "orders": [
        {
            "id": "clx1234567890",
            "success": True
        },
        {
            "id": "clx0987654321",
            "success": False
        }
    ]
}

# Заголовки
headers = {
    "Content-Type": "application/json"
}

# Отправка запроса
response = requests.post(
    url,
    headers=headers,
    json=data
)
```

**С авторизацией через заголовки:**

```python
import requests

url = "http://77.222.47.184:3000/api/shipments/sync-1c"

data = {
    "orders": [
        {"id": "clx1234567890", "success": True},
        {"id": "clx0987654321", "success": False}
    ]
}

headers = {
    "Content-Type": "application/json",
    "X-Login": "admin",
    "X-Password": "admin123"
}

response = requests.post(url, headers=headers, json=data)

# Проверка ответа
if response.status_code == 200:
    result = response.json()
    print(f"Получено {len(result['orders'])} готовых заказов")
    for order in result['orders']:
        print(f"Заказ: {order['number']}, ID: {order['id']}")
else:
    print(f"Ошибка: {response.status_code}")
    print(response.text)
```

---

## 📝 PHP пример

```php
<?php
$url = "http://77.222.47.184:3000/api/shipments/sync-1c";

$data = [
    "orders" => [
        [
            "id" => "clx1234567890",
            "success" => true
        ],
        [
            "id" => "clx0987654321",
            "success" => false
        ]
    ]
];

$options = [
    'http' => [
        'method' => 'POST',
        'header' => [
            'Content-Type: application/json',
            'Cookie: session=your_session_token'
        ],
        'content' => json_encode($data)
    ]
];

$context = stream_context_create($options);
$response = file_get_contents($url, false, $context);

if ($response === false) {
    die('Ошибка запроса');
}

$result = json_decode($response, true);
echo "Получено " . count($result['orders']) . " готовых заказов\n";

foreach ($result['orders'] as $order) {
    echo "Заказ: {$order['number']}, ID: {$order['id']}\n";
}
?>
```

---

## 🔄 Рекомендуемый цикл работы 1С

1. **Первый запрос** - получить готовые заказы:
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": []
  }'
```

2. **Обработать заказы в 1С**

3. **Второй запрос** - сообщить результаты и получить новые:
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{
    "login": "admin",
    "password": "admin123",
    "orders": [
      {"id": "clx1234567890", "success": true},
      {"id": "clx0987654321", "success": true}
    ]
  }'
```

4. **Повторять шаги 2-3** каждые 5-10 минут

---

## ⚠️ Обработка ошибок

### Ошибка 400 - Неверный формат запроса:
```json
{
  "error": "Неверный формат запроса. Ожидается массив orders"
}
```

### Ошибка 403 - Недостаточно прав:
```json
{
  "error": "Недостаточно прав доступа"
}
```
**Решение:** Используйте аккаунт с ролью `admin`

### Ошибка 500 - Ошибка сервера:
```json
{
  "error": "Ошибка синхронизации с 1С",
  "details": "Описание ошибки"
}
```

---

## 📊 Тестирование endpoint

### Проверка доступности:
```bash
curl -I http://77.222.47.184:3000/api/shipments/sync-1c
```

### Тестовый запрос (без авторизации вернет 401/403):
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -d '{"orders": []}'
```

---

## 🔗 Полезные ссылки

- Полная документация API: `docs/API-SYNC-1C.md`
- Инструкция по деплою: `DEPLOY.md`
- Команды для деплоя: `DEPLOY-COMMANDS.md`

