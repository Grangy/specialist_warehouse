# Примеры curl запросов для создания заказа

## Быстрый способ: Использование специального endpoint

### 1. Авторизация и создание тестового заказа (одной командой)

```bash
# Авторизация и сохранение cookie
curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# Создание тестового заказа (использует сохраненный cookie)
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments/create-test" \
  -H "Content-Type: application/json"
```

### 2. Полный пример с обработкой ответа

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
API_URL="${BASE_URL}/api"

# Авторизация
LOGIN_RESPONSE=$(curl -s -c /tmp/cookies.txt -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}')

echo "Авторизация: ${LOGIN_RESPONSE}"

# Создание заказа
CREATE_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST "${API_URL}/shipments/create-test" \
  -H "Content-Type: application/json")

echo "Создание заказа: ${CREATE_RESPONSE}"
```

## Создание кастомного заказа

### 1. Авторизация

```bash
curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'
```

### 2. Создание заказа с кастомными данными

```bash
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "РН-TEST-001",
    "customerName": "ООО Тестовая Компания",
    "destination": "Основной склад",
    "itemsCount": 3,
    "totalQty": 25,
    "weight": 150.5,
    "comment": "Тестовый заказ через curl",
    "businessRegion": "Москва",
    "lines": [
      {
        "sku": "TEST-001",
        "name": "Тестовый товар 1",
        "qty": 10,
        "uom": "шт",
        "location": "Стеллаж A / Полка 1",
        "warehouse": "Склад 1"
      },
      {
        "sku": "TEST-002",
        "name": "Тестовый товар 2",
        "qty": 8,
        "uom": "шт",
        "location": "Стеллаж B / Полка 2",
        "warehouse": "Склад 1"
      },
      {
        "sku": "TEST-003",
        "name": "Тестовый товар 3",
        "qty": 7,
        "uom": "шт",
        "location": "Стеллаж C / Полка 3",
        "warehouse": "Склад 2"
      }
    ]
  }'
```

## Пример для production сервера

```bash
# Для https://sklad.specialist82.pro
BASE_URL="https://sklad.specialist82.pro"

# Авторизация
curl -c /tmp/cookies.txt -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# Создание тестового заказа
curl -b /tmp/cookies.txt -X POST "${BASE_URL}/api/shipments/create-test" \
  -H "Content-Type: application/json"
```

## Пример для сервера по IP

```bash
# Для http://77.222.47.184:3000
BASE_URL="http://77.222.47.184:3000"

# Авторизация
curl -c /tmp/cookies.txt -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}'

# Создание тестового заказа
curl -b /tmp/cookies.txt -X POST "${BASE_URL}/api/shipments/create-test" \
  -H "Content-Type: application/json"
```

## Cron задача

Добавьте в crontab для автоматического создания заказа:

```cron
# Каждые 6 часов создавать тестовый заказ
0 */6 * * * cd /path/to/project && curl -c /tmp/cookies.txt -X POST "http://localhost:3000/api/auth/login" -H "Content-Type: application/json" -d '{"login":"admin","password":"admin123"}' > /dev/null 2>&1 && curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments/create-test" -H "Content-Type: application/json" >> /var/log/test-order.log 2>&1 && rm -f /tmp/cookies.txt
```

Или используйте bash-скрипт:

```cron
# Каждые 6 часов
0 */6 * * * /path/to/project/scripts/curl-create-order.sh >> /var/log/test-order.log 2>&1
```

## Форматированный вывод (с jq)

Если установлен `jq`, можно форматировать JSON ответы:

```bash
curl -b /tmp/cookies.txt -X POST "http://localhost:3000/api/shipments/create-test" \
  -H "Content-Type: application/json" | jq '.'
```

## Обработка ошибок

```bash
#!/bin/bash

BASE_URL="http://localhost:3000"
API_URL="${BASE_URL}/api"

# Авторизация с проверкой
LOGIN_RESPONSE=$(curl -s -w "\n%{http_code}" -c /tmp/cookies.txt -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}')

HTTP_CODE=$(echo "${LOGIN_RESPONSE}" | tail -n1)
BODY=$(echo "${LOGIN_RESPONSE}" | head -n-1)

if [ "${HTTP_CODE}" -eq 200 ]; then
  echo "✅ Авторизация успешна"
  
  # Создание заказа
  CREATE_RESPONSE=$(curl -s -w "\n%{http_code}" -b /tmp/cookies.txt -X POST "${API_URL}/shipments/create-test" \
    -H "Content-Type: application/json")
  
  CREATE_HTTP_CODE=$(echo "${CREATE_RESPONSE}" | tail -n1)
  CREATE_BODY=$(echo "${CREATE_RESPONSE}" | head -n-1)
  
  if [ "${CREATE_HTTP_CODE}" -eq 200 ]; then
    echo "✅ Заказ создан успешно"
    echo "${CREATE_BODY}" | jq '.'
  else
    echo "❌ Ошибка создания заказа (HTTP ${CREATE_HTTP_CODE})"
    echo "${CREATE_BODY}"
    exit 1
  fi
else
  echo "❌ Ошибка авторизации (HTTP ${HTTP_CODE})"
  echo "${BODY}"
  exit 1
fi

rm -f /tmp/cookies.txt
```

## Примечания

1. **Cookie файл**: Используется `/tmp/cookies.txt` для сохранения сессии. Убедитесь, что у пользователя есть права на запись в `/tmp`.

2. **Безопасность**: Не храните пароли в открытом виде в скриптах. Используйте переменные окружения или файлы с ограниченными правами доступа.

3. **HTTPS**: Для production серверов используйте HTTPS вместо HTTP.

4. **Таймауты**: При необходимости добавьте флаги `--max-time` или `--connect-timeout` для curl.

5. **Проверка ответа**: Всегда проверяйте HTTP код ответа и содержимое для обработки ошибок.



