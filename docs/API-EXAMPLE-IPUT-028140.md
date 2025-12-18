# 📋 Пример: Обновление количества для заказа ИПУТ-028140

Практический пример POST запросов для обновления количества товаров в заказе **ИПУТ-028140** из системы 1С.

---

## 🔍 Шаг 1: Получение информации о заказе

Сначала нужно получить информацию о заказе и найти `taskId` (ID задания).

### Запрос:
```bash
curl -X GET "http://77.222.47.184:3000/api/shipments?status=new" \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" | jq '.[] | select(.number == "ИПУТ-028140")'
```

### Ответ:
```json
{
  "id": "shipment_id_abc123",
  "number": "ИПУТ-028140",
  "customer_name": "ООО Клиент",
  "destination": "Основной склад / Рампа 3",
  "status": "new",
  "tasks": [
    {
      "id": "task_id_xyz789",
      "warehouse": "Склад 1",
      "status": "new",
      "lines": [
        {
          "sku": "SKU-001",
          "name": "Товар 1",
          "qty": 10,
          "collected_qty": null
        },
        {
          "sku": "SKU-002",
          "name": "Товар 2",
          "qty": 5,
          "collected_qty": null
        }
      ]
    }
  ]
}
```

**Важно:** Сохраните `taskId` из ответа (например, `task_id_xyz789`).

---

## 📦 Шаг 2: Обновление количества при сборке

После получения `taskId`, обновляем количество собранных товаров.

### Запрос:
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/task_id_xyz789/save-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: admin" \
  -H "X-Password: admin123" \
  -d '{
    "lines": [
      {
        "sku": "SKU-001",
        "collected_qty": 8
      },
      {
        "sku": "SKU-002",
        "collected_qty": 5
      }
    ]
  }'
```

### Тело запроса (JSON):
```json
{
  "lines": [
    {
      "sku": "SKU-001",
      "collected_qty": 8
    },
    {
      "sku": "SKU-002",
      "collected_qty": 5
    }
  ]
}
```

### Ответ:
```json
{
  "success": true,
  "progress": {
    "collected": 2,
    "total": 2
  }
}
```

---

## ✅ Шаг 3: Обновление количества при проверке

После того, как заказ переведен в статус "ожидание подтверждения", можно обновить подтвержденное количество.

### Запрос:
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/task_id_xyz789/save-confirmation-progress \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "lines": [
      {
        "sku": "SKU-001",
        "confirmed_qty": 7,
        "confirmed": true
      },
      {
        "sku": "SKU-002",
        "confirmed_qty": 5,
        "confirmed": true
      }
    ]
  }'
```

### Тело запроса (JSON):
```json
{
  "lines": [
    {
      "sku": "SKU-001",
      "confirmed_qty": 7,
      "confirmed": true
    },
    {
      "sku": "SKU-002",
      "confirmed_qty": 5,
      "confirmed": true
    }
  ]
}
```

### Ответ:
```json
{
  "success": true,
  "progress": {
    "confirmed": 2,
    "total": 2
  }
}
```

---

## 🎯 Шаг 4: Финальное подтверждение заказа

После проверки всех позиций, подтверждаем задание с комментарием и количеством мест.

### Запрос:
```bash
curl -X POST http://77.222.47.184:3000/api/shipments/task_id_xyz789/confirm \
  -H "Content-Type: application/json" \
  -H "X-Login: checker" \
  -H "X-Password: checker123" \
  -d '{
    "lines": [
      {
        "sku": "SKU-001",
        "confirmed_qty": 7,
        "confirmed": true
      },
      {
        "sku": "SKU-002",
        "confirmed_qty": 5,
        "confirmed": true
      }
    ],
    "comment": "Заказ ИПУТ-028140 готов к отправке",
    "places": 2
  }'
```

### Тело запроса (JSON):
```json
{
  "lines": [
    {
      "sku": "SKU-001",
      "confirmed_qty": 7,
      "confirmed": true
    },
    {
      "sku": "SKU-002",
      "confirmed_qty": 5,
      "confirmed": true
    }
  ],
  "comment": "Заказ ИПУТ-028140 готов к отправке",
  "places": 2
}
```

### Ответ (если все задания подтверждены):
```json
{
  "success": true,
  "message": "Задание подтверждено. Все задания заказа подтверждены - заказ отправлен в офис",
  "shipment_number": "ИПУТ-028140",
  "all_tasks_confirmed": true,
  "tasks_progress": {
    "confirmed": 1,
    "total": 1
  },
  "final_order_data": {
    "number": "ИПУТ-028140",
    "customer_name": "ООО Клиент",
    "destination": "Основной склад / Рампа 3",
    "comment": "Заказ ИПУТ-028140 готов к отправке",
    "places": 2,
    "lines": [
      {
        "sku": "SKU-001",
        "name": "Товар 1",
        "qty": 10,
        "collected_qty": 7
      },
      {
        "sku": "SKU-002",
        "name": "Товар 2",
        "qty": 5,
        "collected_qty": 5
      }
    ]
  }
}
```

---

## 🔄 Полный workflow для заказа ИПУТ-028140

### Вариант 1: JavaScript (Node.js / 1C HTTP-сервис)

```javascript
const BASE_URL = 'http://77.222.47.184:3000';
const LOGIN = 'admin';
const PASSWORD = 'admin123';
const ORDER_NUMBER = 'ИПУТ-028140';

// Функция для выполнения запросов
async function makeRequest(method, endpoint, data = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Login': LOGIN,
      'X-Password': PASSWORD,
    },
  };
  
  if (data) {
    options.body = JSON.stringify(data);
  }
  
  const response = await fetch(url, options);
  return await response.json();
}

// 1. Получаем информацию о заказе
async function getOrderInfo() {
  const shipments = await makeRequest('GET', '/api/shipments?status=new');
  const order = shipments.find(s => s.number === ORDER_NUMBER);
  
  if (!order) {
    throw new Error(`Заказ ${ORDER_NUMBER} не найден`);
  }
  
  console.log(`Найден заказ: ${order.number}, ID: ${order.id}`);
  console.log(`Заданий: ${order.tasks.length}`);
  
  return order;
}

// 2. Обновляем количество при сборке
async function updateCollectionProgress(taskId, lines) {
  const result = await makeRequest('POST', `/api/shipments/${taskId}/save-progress`, {
    lines: lines.map(line => ({
      sku: line.sku,
      collected_qty: line.collected_qty
    }))
  });
  
  console.log(`Прогресс сборки: ${result.progress.collected}/${result.progress.total}`);
  return result;
}

// 3. Обновляем количество при проверке
async function updateConfirmationProgress(taskId, lines) {
  const result = await makeRequest('POST', `/api/shipments/${taskId}/save-confirmation-progress`, {
    lines: lines.map(line => ({
      sku: line.sku,
      confirmed_qty: line.confirmed_qty,
      confirmed: true
    }))
  });
  
  console.log(`Прогресс проверки: ${result.progress.confirmed}/${result.progress.total}`);
  return result;
}

// 4. Подтверждаем заказ
async function confirmOrder(taskId, lines, comment, places) {
  const result = await makeRequest('POST', `/api/shipments/${taskId}/confirm`, {
    lines: lines.map(line => ({
      sku: line.sku,
      confirmed_qty: line.confirmed_qty,
      confirmed: true
    })),
    comment,
    places
  });
  
  if (result.all_tasks_confirmed) {
    console.log('✅ Все задания подтверждены! Заказ готов к выгрузке в 1С');
    console.log('Данные для 1С:', JSON.stringify(result.final_order_data, null, 2));
  }
  
  return result;
}

// Основная функция
async function processOrder() {
  try {
    // 1. Получаем информацию о заказе
    const order = await getOrderInfo();
    const taskId = order.tasks[0].id; // Берем первое задание
    
    // 2. Обновляем количество при сборке
    await updateCollectionProgress(taskId, [
      { sku: 'SKU-001', collected_qty: 8 },
      { sku: 'SKU-002', collected_qty: 5 }
    ]);
    
    // 3. Обновляем количество при проверке (изменяем SKU-001 с 8 на 7)
    await updateConfirmationProgress(taskId, [
      { sku: 'SKU-001', confirmed_qty: 7 },
      { sku: 'SKU-002', confirmed_qty: 5 }
    ]);
    
    // 4. Подтверждаем заказ
    await confirmOrder(
      taskId,
      [
        { sku: 'SKU-001', confirmed_qty: 7 },
        { sku: 'SKU-002', confirmed_qty: 5 }
      ],
      'Заказ ИПУТ-028140 готов к отправке',
      2
    );
    
    console.log('✅ Заказ успешно обработан!');
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
  }
}

// Запуск
processOrder();
```

### Вариант 2: Python

```python
import requests
import json

BASE_URL = 'http://77.222.47.184:3000'
LOGIN = 'admin'
PASSWORD = 'admin123'
ORDER_NUMBER = 'ИПУТ-028140'

def make_request(method, endpoint, data=None):
    url = f"{BASE_URL}{endpoint}"
    headers = {
        'Content-Type': 'application/json',
        'X-Login': LOGIN,
        'X-Password': PASSWORD,
    }
    
    if method == 'GET':
        response = requests.get(url, headers=headers)
    else:
        response = requests.post(url, json=data, headers=headers)
    
    return response.json()

# 1. Получаем информацию о заказе
def get_order_info():
    shipments = make_request('GET', '/api/shipments?status=new')
    order = next((s for s in shipments if s['number'] == ORDER_NUMBER), None)
    
    if not order:
        raise Exception(f'Заказ {ORDER_NUMBER} не найден')
    
    print(f"Найден заказ: {order['number']}, ID: {order['id']}")
    print(f"Заданий: {len(order['tasks'])}")
    
    return order

# 2. Обновляем количество при сборке
def update_collection_progress(task_id, lines):
    data = {
        'lines': [
            {'sku': line['sku'], 'collected_qty': line['collected_qty']}
            for line in lines
        ]
    }
    result = make_request('POST', f'/api/shipments/{task_id}/save-progress', data)
    print(f"Прогресс сборки: {result['progress']['collected']}/{result['progress']['total']}")
    return result

# 3. Обновляем количество при проверке
def update_confirmation_progress(task_id, lines):
    data = {
        'lines': [
            {
                'sku': line['sku'],
                'confirmed_qty': line['confirmed_qty'],
                'confirmed': True
            }
            for line in lines
        ]
    }
    result = make_request('POST', f'/api/shipments/{task_id}/save-confirmation-progress', data)
    print(f"Прогресс проверки: {result['progress']['confirmed']}/{result['progress']['total']}")
    return result

# 4. Подтверждаем заказ
def confirm_order(task_id, lines, comment, places):
    data = {
        'lines': [
            {
                'sku': line['sku'],
                'confirmed_qty': line['confirmed_qty'],
                'confirmed': True
            }
            for line in lines
        ],
        'comment': comment,
        'places': places
    }
    result = make_request('POST', f'/api/shipments/{task_id}/confirm', data)
    
    if result.get('all_tasks_confirmed'):
        print('✅ Все задания подтверждены! Заказ готов к выгрузке в 1С')
        print(f"Данные для 1С: {json.dumps(result['final_order_data'], indent=2, ensure_ascii=False)}")
    
    return result

# Основная функция
def process_order():
    try:
        # 1. Получаем информацию о заказе
        order = get_order_info()
        task_id = order['tasks'][0]['id']  # Берем первое задание
        
        # 2. Обновляем количество при сборке
        update_collection_progress(task_id, [
            {'sku': 'SKU-001', 'collected_qty': 8},
            {'sku': 'SKU-002', 'collected_qty': 5}
        ])
        
        # 3. Обновляем количество при проверке
        update_confirmation_progress(task_id, [
            {'sku': 'SKU-001', 'confirmed_qty': 7},
            {'sku': 'SKU-002', 'confirmed_qty': 5}
        ])
        
        # 4. Подтверждаем заказ
        confirm_order(
            task_id,
            [
                {'sku': 'SKU-001', 'confirmed_qty': 7},
                {'sku': 'SKU-002', 'confirmed_qty': 5}
            ],
            'Заказ ИПУТ-028140 готов к отправке',
            2
        )
        
        print('✅ Заказ успешно обработан!')
    except Exception as e:
        print(f'❌ Ошибка: {e}')

# Запуск
if __name__ == '__main__':
    process_order()
```

---

## 📝 Краткая справка для 1С

### Для обновления количества при сборке:
```
POST /api/shipments/{taskId}/save-progress
Headers: X-Login: admin, X-Password: admin123
Body: { "lines": [{"sku": "...", "collected_qty": 10}] }
```

### Для обновления количества при проверке:
```
POST /api/shipments/{taskId}/save-confirmation-progress
Headers: X-Login: checker, X-Password: checker123
Body: { "lines": [{"sku": "...", "confirmed_qty": 8, "confirmed": true}] }
```

### Для финального подтверждения:
```
POST /api/shipments/{taskId}/confirm
Headers: X-Login: checker, X-Password: checker123
Body: { "lines": [...], "comment": "...", "places": 2 }
```

### Как найти taskId:
1. Выполнить `GET /api/shipments?status=new`
2. Найти заказ по номеру "ИПУТ-028140"
3. Взять `tasks[0].id` (ID первого задания)

---

## ⚠️ Важные замечания

1. **TaskId vs ShipmentId**: В URL используется `taskId` (ID задания), а не `shipmentId` (ID заказа)!

2. **Номер заказа**: Номер заказа "ИПУТ-028140" используется только для поиска заказа. Для обновления нужен `taskId`.

3. **Изменение количества**: 
   - При сборке: `collected_qty` (например, собрали 8 из 10)
   - При проверке: `confirmed_qty` (например, подтвердили 7 из 8 собранных)

4. **Авторизация**: 
   - Сборка: `admin` или `collector`
   - Проверка: `admin` или `checker`

5. **Статусы**: 
   - Сборка: задание в статусе `new`
   - Проверка: задание в статусе `pending_confirmation`

