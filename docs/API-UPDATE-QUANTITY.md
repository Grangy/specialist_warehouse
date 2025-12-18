# 📝 API: Обновление количества заказов

Документация по POST запросам для обновления количества товаров при сборке и проверке.

## 🔑 Авторизация

Все запросы требуют авторизации через cookies (сессия) или заголовки.

### Через cookies (веб-интерфейс)
Авторизация происходит автоматически при входе в систему.

### Через заголовки (внешние системы)
```bash
X-Login: admin
X-Password: admin123
```

---

## 1. Обновление количества при сборке

**Endpoint:** `POST /api/shipments/[taskId]/save-progress`

**Описание:** Сохраняет прогресс сборки (количество собранных товаров) для задания.

**Параметры:**
- `taskId` (в URL) - ID задания (task), не shipment!

**Тело запроса:**
```json
{
  "lines": [
    {
      "sku": "123-456",
      "collected_qty": 10
    },
    {
      "sku": "123-457",
      "collected_qty": 5
    }
  ]
}
```

**Поля:**
- `lines` - массив объектов с информацией о позициях
- `sku` - артикул товара (обязательно)
- `collected_qty` - собранное количество (может быть `null` или `0`)

**Важно:**
- Если `collected_qty` не указан или `null`, позиция считается не собранной
- `checked` устанавливается автоматически: `true` если `collected_qty > 0`, иначе `false`
- Задание должно быть заблокировано текущим пользователем

### Примеры запросов

#### cURL
```bash
# Обновление количества для одного товара
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-progress \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "collected_qty": 10
      }
    ]
  }'

# Обновление количества для нескольких товаров
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "collected_qty": 10
      },
      {
        "sku": "123-457",
        "collected_qty": 5
      },
      {
        "sku": "123-458",
        "collected_qty": 0
      }
    ]
  }'

# Установка количества в null (позиция не собрана)
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "collected_qty": null
      }
    ]
  }'
```

#### JavaScript (fetch)
```javascript
// Обновление количества при сборке
async function updateCollectionProgress(taskId, lines) {
  const response = await fetch(`http://77.222.47.184:3000/api/shipments/${taskId}/save-progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Авторизация через заголовки
      'X-Login': 'admin',
      'X-Password': 'admin123',
      // Или через cookies (автоматически)
    },
    credentials: 'include', // Для отправки cookies
    body: JSON.stringify({
      lines: [
        {
          sku: '123-456',
          collected_qty: 10
        },
        {
          sku: '123-457',
          collected_qty: 5
        }
      ]
    })
  });

  const data = await response.json();
  console.log('Прогресс сборки:', data);
  // Ответ: { success: true, progress: { collected: 2, total: 5 } }
}
```

#### Python (requests)
```python
import requests

# Обновление количества при сборке
def update_collection_progress(task_id, lines):
    url = f"http://77.222.47.184:3000/api/shipments/{task_id}/save-progress"
    
    headers = {
        'Content-Type': 'application/json',
        'X-Login': 'admin',
        'X-Password': 'admin123'
    }
    
    data = {
        'lines': [
            {
                'sku': '123-456',
                'collected_qty': 10
            },
            {
                'sku': '123-457',
                'collected_qty': 5
            }
        ]
    }
    
    response = requests.post(url, json=data, headers=headers)
    result = response.json()
    print(f"Прогресс сборки: {result['progress']}")
    return result
```

**Ответ:**
```json
{
  "success": true,
  "progress": {
    "collected": 2,
    "total": 5
  }
}
```

**Ошибки:**
- `404` - Задание не найдено
- `403` - Задание заблокировано другим пользователем или не заблокировано
- `500` - Ошибка сервера

---

## 2. Обновление количества при проверке

**Endpoint:** `POST /api/shipments/[taskId]/save-confirmation-progress`

**Описание:** Сохраняет прогресс проверки (подтвержденное количество) для задания.

**Параметры:**
- `taskId` (в URL) - ID задания (task), не shipment!

**Тело запроса:**
```json
{
  "lines": [
    {
      "sku": "123-456",
      "confirmed_qty": 8,
      "confirmed": true
    },
    {
      "sku": "123-457",
      "confirmed_qty": 5,
      "confirmed": true
    }
  ]
}
```

**Поля:**
- `lines` - массив объектов с информацией о позициях
- `sku` - артикул товара (обязательно)
- `confirmed_qty` - подтвержденное количество (может быть `null`)
- `confirmed` - флаг подтверждения (опционально, по умолчанию берется из БД)

**Важно:**
- Только роли `admin` и `checker` могут обновлять прогресс проверки
- Задание должно быть в статусе `pending_confirmation`
- Если `confirmed_qty` не указан, используется текущее значение из БД
- Если `confirmed` не указан, используется текущее значение из БД

### Примеры запросов

#### cURL
```bash
# Обновление подтвержденного количества
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-confirmation-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "confirmed_qty": 8,
        "confirmed": true
      },
      {
        "sku": "123-457",
        "confirmed_qty": 5,
        "confirmed": true
      }
    ]
  }'

# Изменение количества при проверке (было 10, стало 8)
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-confirmation-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "confirmed_qty": 8,
        "confirmed": true
      }
    ]
  }'
```

#### JavaScript (fetch)
```javascript
// Обновление количества при проверке
async function updateConfirmationProgress(taskId, lines) {
  const response = await fetch(`http://77.222.47.184:3000/api/shipments/${taskId}/save-confirmation-progress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Login': 'checker',
      'X-Password': 'checker123',
    },
    credentials: 'include',
    body: JSON.stringify({
      lines: [
        {
          sku: '123-456',
          confirmed_qty: 8,
          confirmed: true
        },
        {
          sku: '123-457',
          confirmed_qty: 5,
          confirmed: true
        }
      ]
    })
  });

  const data = await response.json();
  console.log('Прогресс проверки:', data);
  // Ответ: { success: true, progress: { confirmed: 2, total: 5 } }
}
```

#### Python (requests)
```python
import requests

# Обновление количества при проверке
def update_confirmation_progress(task_id, lines):
    url = f"http://77.222.47.184:3000/api/shipments/{task_id}/save-confirmation-progress"
    
    headers = {
        'Content-Type': 'application/json',
        'X-Login': 'checker',
        'X-Password': 'checker123'
    }
    
    data = {
        'lines': [
            {
                'sku': '123-456',
                'confirmed_qty': 8,
                'confirmed': True
            },
            {
                'sku': '123-457',
                'confirmed_qty': 5,
                'confirmed': True
            }
        ]
    }
    
    response = requests.post(url, json=data, headers=headers)
    result = response.json()
    print(f"Прогресс проверки: {result['progress']}")
    return result
```

**Ответ:**
```json
{
  "success": true,
  "progress": {
    "confirmed": 2,
    "total": 5
  }
}
```

**Ошибки:**
- `404` - Задание не найдено
- `400` - Задание не в статусе `pending_confirmation`
- `403` - Недостаточно прав доступа (требуется роль `admin` или `checker`)
- `500` - Ошибка сервера

---

## 3. Подтверждение заказа (финальное)

**Endpoint:** `POST /api/shipments/[taskId]/confirm`

**Описание:** Финальное подтверждение задания с возможностью указать комментарий и количество мест.

**Параметры:**
- `taskId` (в URL) - ID задания (task), не shipment!

**Тело запроса:**
```json
{
  "lines": [
    {
      "sku": "123-456",
      "confirmed_qty": 8,
      "confirmed": true
    }
  ],
  "comment": "Дополнительный комментарий",
  "places": 2
}
```

**Поля:**
- `lines` - массив объектов с информацией о позициях (опционально, если не указано, используются данные из БД)
- `comment` - комментарий к заказу (опционально)
- `places` - количество мест/упаковок (опционально)

**Важно:**
- Только роли `admin` и `checker` могут подтверждать заказы
- Задание должно быть в статусе `pending_confirmation`
- Если все задания заказа подтверждены, заказ переходит в статус `processed` и готов к выгрузке в 1С

### Примеры запросов

#### cURL
```bash
# Подтверждение задания с комментарием и количеством мест
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/confirm \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "lines": [
      {
        "sku": "123-456",
        "confirmed_qty": 8,
        "confirmed": true
      }
    ],
    "comment": "Заказ готов к отправке",
    "places": 2
  }'

# Подтверждение без изменения количеств (используются данные из БД)
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/confirm \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "comment": "Все проверено",
    "places": 1
  }'
```

#### JavaScript (fetch)
```javascript
// Подтверждение задания
async function confirmTask(taskId, lines, comment, places) {
  const response = await fetch(`http://77.222.47.184:3000/api/shipments/${taskId}/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Login': 'admin',
      'X-Password': 'admin123',
    },
    credentials: 'include',
    body: JSON.stringify({
      lines: lines || undefined,
      comment: comment || undefined,
      places: places || undefined
    })
  });

  const data = await response.json();
  console.log('Результат подтверждения:', data);
  
  if (data.all_tasks_confirmed) {
    console.log('Все задания подтверждены! Заказ готов к выгрузке в 1С');
    console.log('Данные для 1С:', data.final_order_data);
  }
  
  return data;
}
```

#### Python (requests)
```python
import requests

# Подтверждение задания
def confirm_task(task_id, lines=None, comment=None, places=None):
    url = f"http://77.222.47.184:3000/api/shipments/{task_id}/confirm"
    
    headers = {
        'Content-Type': 'application/json',
        'X-Login': 'admin',
        'X-Password': 'admin123'
    }
    
    data = {}
    if lines:
        data['lines'] = lines
    if comment:
        data['comment'] = comment
    if places:
        data['places'] = places
    
    response = requests.post(url, json=data, headers=headers)
    result = response.json()
    
    if result.get('all_tasks_confirmed'):
        print("Все задания подтверждены! Заказ готов к выгрузке в 1С")
        print(f"Данные для 1С: {result.get('final_order_data')}")
    
    return result
```

**Ответ (если не все задания подтверждены):**
```json
{
  "success": true,
  "message": "Задание подтверждено",
  "shipment_number": "РН-000123",
  "all_tasks_confirmed": false,
  "tasks_progress": {
    "confirmed": 1,
    "total": 3
  },
  "task": {
    "id": "TASK_ID_123",
    "status": "processed",
    "lines": [...]
  }
}
```

**Ответ (если все задания подтверждены):**
```json
{
  "success": true,
  "message": "Задание подтверждено. Все задания заказа подтверждены - заказ отправлен в офис",
  "shipment_number": "РН-000123",
  "all_tasks_confirmed": true,
  "tasks_progress": {
    "confirmed": 3,
    "total": 3
  },
  "final_order_data": {
    "number": "РН-000123",
    "customer_name": "ООО Клиент",
    "destination": "Основной склад / Рампа 3",
    "comment": "Заказ готов к отправке",
    "places": 2,
    "lines": [
      {
        "sku": "123-456",
        "name": "Товар 1",
        "qty": 10,
        "collected_qty": 8,
        ...
      }
    ],
    ...
  },
  "task": {...}
}
```

**Ошибки:**
- `404` - Задание не найдено
- `400` - Задание не в статусе `pending_confirmation`
- `403` - Недостаточно прав доступа (требуется роль `admin` или `checker`)
- `500` - Ошибка сервера

---

## 🔍 Как найти taskId?

TaskId можно получить из API списка заказов:

```bash
# Получить список заказов с заданиями
curl -X GET http://77.222.47.184:3000/api/shipments \
  -H "Cookie: session=YOUR_SESSION_COOKIE" | jq '.[0].tasks[0].id'
```

Или из ответа при получении задания:

```bash
# Получить информацию о задании
curl -X GET http://77.222.47.184:3000/api/shipments/TASK_ID_123 \
  -H "Cookie: session=YOUR_SESSION_COOKIE"
```

---

## 📊 Полный пример workflow

```bash
# 1. Получить список заказов
curl -X GET http://77.222.47.184:3000/api/shipments \
  -H "Cookie: session=YOUR_SESSION_COOKIE" > shipments.json

# 2. Заблокировать задание для работы
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/lock \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{"userId": "USER_ID"}'

# 3. Обновить количество при сборке
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-progress \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{
    "lines": [
      {"sku": "123-456", "collected_qty": 10}
    ]
  }'

# 4. Перевести в статус ожидания подтверждения
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/pending_confirmation \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{
    "lines": [
      {"sku": "123-456", "collected_qty": 10}
    ]
  }'

# 5. Обновить количество при проверке
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/save-confirmation-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "lines": [
      {"sku": "123-456", "confirmed_qty": 8, "confirmed": true}
    ]
  }'

# 6. Подтвердить задание
curl -X POST http://77.222.47.184:3000/api/shipments/TASK_ID_123/confirm \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "comment": "Готово к отправке",
    "places": 2
  }'
```

---

## ⚠️ Важные замечания

1. **TaskId vs ShipmentId**: В URL используется `taskId` (ID задания), а не `shipmentId` (ID заказа)!

2. **Блокировка**: Перед обновлением количества при сборке задание должно быть заблокировано.

3. **Статусы**: 
   - Сборка: задание в статусе `new`
   - Проверка: задание в статусе `pending_confirmation`

4. **Количества**:
   - `collected_qty` - количество при сборке
   - `confirmed_qty` - количество при проверке (может отличаться от `collected_qty`)

5. **Авторизация**: 
   - Сборка: роли `admin`, `collector`
   - Проверка: роли `admin`, `checker`

