# 📦 API: Готовые к выгрузке заказы

Endpoint для получения списка заказов, готовых к выгрузке в 1С.

---

## 🔗 Endpoint

**GET** `/api/shipments/ready-for-export`

**Описание:** Возвращает список заказов со статусом `processed`, где все задания подтверждены, но еще не выгружены в 1С (`exportedTo1C = false`).

---

## 🔐 Авторизация

### Через заголовки:
```
X-Login: admin
X-Password: admin123
```

### Через cookies:
Авторизация происходит автоматически при входе в систему через веб-интерфейс.

**Требуемая роль:** `admin`

---

## 📥 Запрос

### cURL
```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123"
```

### JavaScript (fetch)
```javascript
const response = await fetch('http://77.222.47.184:3000/api/shipments/ready-for-export', {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    'X-Login': 'admin',
    'X-Password': 'admin123',
  },
});

const data = await response.json();
console.log('Готовых заказов:', data.count);
console.log('Заказы:', data.orders);
```

### Python (requests)
```python
import requests

url = 'http://77.222.47.184:3000/api/shipments/ready-for-export'
headers = {
    'Content-Type': 'application/json',
    'X-Login': 'admin',
    'X-Password': 'admin123',
}

response = requests.get(url, headers=headers)
data = response.json()

print(f"Готовых заказов: {data['count']}")
for order in data['orders']:
    print(f"  - {order['number']}: {order['customer_name']}")
```

---

## 📤 Ответ

### Успешный ответ (200 OK)

```json
{
  "orders": [
    {
      "id": "shipment_id_abc123",
      "number": "ИПУТ-028140",
      "customer_name": "ООО Клиент",
      "destination": "Основной склад / Рампа 3",
      "status": "processed",
      "business_region": "Москва",
      "comment": "Заказ готов к отправке",
      "places": 2,
      "created_at": "2025-01-15T10:00:00.000Z",
      "confirmed_at": "2025-01-15T14:30:00.000Z",
      "processed_at": "2025-01-15T14:30:00.000Z",
      "tasks_count": 1,
      "items_count": 5,
      "total_qty": 25,
      "weight": 150.5,
      "lines": [
        {
          "sku": "SKU-001",
          "name": "Товар 1",
          "qty": 10,
          "collected_qty": 8,
          "uom": "шт",
          "location": "Стеллаж A1 / Полка 1",
          "warehouse": "Склад 1",
          "checked": true
        },
        {
          "sku": "SKU-002",
          "name": "Товар 2",
          "qty": 5,
          "collected_qty": 5,
          "uom": "шт",
          "location": "Стеллаж A2 / Полка 1",
          "warehouse": "Склад 1",
          "checked": true
        }
      ],
      "tasks": [
        {
          "id": "task_id_xyz789",
          "warehouse": "Склад 1",
          "status": "processed",
          "collector_name": "Иванов Иван",
          "items_count": 2,
          "total_qty": 13
        }
      ]
    }
  ],
  "count": 1
}
```

### Пустой список (нет готовых заказов)

```json
{
  "orders": [],
  "count": 0
}
```

### Ошибка авторизации (401 Unauthorized)

```json
{
  "error": "Требуется авторизация. Укажите заголовки X-Login и X-Password, или авторизуйтесь через cookies"
}
```

### Ошибка доступа (403 Forbidden)

```json
{
  "error": "Недостаточно прав доступа. Требуется роль admin"
}
```

### Ошибка сервера (500 Internal Server Error)

```json
{
  "error": "Ошибка получения готовых заказов",
  "details": "Описание ошибки"
}
```

---

## 📋 Описание полей ответа

### Основная информация о заказе:
- `id` - ID заказа в системе (используется для идентификации в 1С)
- `number` - Номер заказа (например, "ИПУТ-028140")
- `customer_name` - Наименование клиента
- `destination` - Назначение/адрес доставки
- `status` - Статус заказа (всегда "processed" для готовых заказов)
- `business_region` - Бизнес-регион
- `comment` - Комментарий к заказу
- `places` - Количество мест/упаковок
- `created_at` - Дата создания заказа (ISO 8601)
- `confirmed_at` - Дата подтверждения заказа (ISO 8601)
- `processed_at` - Дата обработки заказа (ISO 8601)
- `tasks_count` - Количество заданий в заказе
- `items_count` - Количество позиций в заказе
- `total_qty` - Общее количество товаров (с учетом изменений)
- `weight` - Вес заказа

### Информация о позициях (lines):
- `sku` - Артикул товара
- `name` - Наименование товара
- `qty` - Заказанное количество
- `collected_qty` - Фактическое собранное/подтвержденное количество (может отличаться от `qty`)
- `uom` - Единица измерения
- `location` - Место хранения
- `warehouse` - Склад
- `checked` - Флаг проверки

### Информация о заданиях (tasks):
- `id` - ID задания
- `warehouse` - Склад задания
- `status` - Статус задания (всегда "processed" для готовых заказов)
- `collector_name` - Имя сборщика
- `items_count` - Количество позиций в задании
- `total_qty` - Общее количество товаров в задании

---

## 🔄 Workflow использования

### 1. Получение списка готовых заказов

```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "X-Login: admin" \
  -H "X-Password: admin123"
```

### 2. Обработка заказов в 1С

1С обрабатывает полученные заказы и сохраняет их у себя.

### 3. Подтверждение обработки в 1С

После обработки, 1С отправляет подтверждение через endpoint `/api/shipments/sync-1c`:

```bash
curl -X POST http://77.222.47.184:3000/api/shipments/sync-1c \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "orders": [
      {
        "id": "shipment_id_abc123",
        "success": true
      }
    ]
  }'
```

После этого заказ помечается как `exportedTo1C = true` и больше не будет возвращаться в списке готовых заказов.

---

## 💡 Примеры использования

### Получить только количество готовых заказов

```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "X-Login: admin" \
  -H "X-Password: admin123" | jq '.count'
```

### Получить только номера заказов

```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "X-Login: admin" \
  -H "X-Password: admin123" | jq '.orders[].number'
```

### Получить заказы с измененными количествами

```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "X-Login: admin" \
  -H "X-Password: admin123" | jq '.orders[] | select(.lines[] | .qty != .collected_qty)'
```

### Получить заказы конкретного клиента

```bash
curl -X GET http://77.222.47.184:3000/api/shipments/ready-for-export \
  -H "X-Login: admin" \
  -H "X-Password: admin123" | jq '.orders[] | select(.customer_name == "ООО Клиент")'
```

---

## ⚠️ Важные замечания

1. **Количество товаров**: Поле `collected_qty` в `lines` содержит фактическое подтвержденное количество, которое может отличаться от заказанного (`qty`). Это количество учитывает все изменения, сделанные при сборке и проверке.

2. **Сортировка**: Заказы возвращаются отсортированными по дате подтверждения (старые первыми), чтобы обрабатывать их в порядке очереди.

3. **Повторные запросы**: Один и тот же заказ будет возвращаться в списке до тех пор, пока не будет помечен как `exportedTo1C = true` через endpoint `/api/shipments/sync-1c`.

4. **Множественные задания**: Если заказ разбит на несколько заданий, количества суммируются по всем заданиям для каждой позиции.

5. **Авторизация**: Endpoint требует роль `admin`. Для других ролей вернется ошибка 403.

---

## 🔗 Связанные endpoints

- **POST** `/api/shipments/sync-1c` - Синхронизация с 1С (обновление статусов и получение готовых заказов)
- **GET** `/api/shipments` - Получение списка всех заказов
- **GET** `/api/shipments/[id]` - Получение информации о конкретном заказе

