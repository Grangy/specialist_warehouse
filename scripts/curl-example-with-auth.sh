#!/bin/bash

# Правильный пример curl запроса с авторизацией в теле запроса

BASE_URL="http://77.222.47.184:3000"
API_URL="${BASE_URL}/api"

echo "🧪 Тестирование API с авторизацией в запросе"
echo "URL: ${API_URL}/shipments"
echo ""

# Учетные данные
LOGIN="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-admin123}"

# Создаем JSON через переменную (БЕЗ login/password в теле)
JSON_DATA=$(cat <<'EOF'
{
  "number": "РН-20251210-123456",
  "customerName": "ООО Моя Компания",
  "destination": "Основной склад",
  "businessRegion": "Москва",
  "comment": "Заказ создан через curl",
  "itemsCount": 2,
  "totalQty": 15,
  "weight": 80.5,
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
}
EOF
)

echo "📋 Отправляемый JSON (первые 200 символов):"
echo "$JSON_DATA" | head -c 200
echo "..."
echo ""

# Проверяем, что JSON валиден
if ! echo "$JSON_DATA" | jq . > /dev/null 2>&1; then
  echo "❌ Ошибка: JSON невалиден!"
  exit 1
fi

echo "✅ JSON валиден"
echo ""

# Отправляем запрос с авторизацией в заголовках
echo "📤 Отправка запроса с авторизацией в заголовках..."
echo "   X-Login: ${LOGIN}"
echo "   X-Password: ***"
echo ""
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${API_URL}/shipments" \
  -H "Content-Type: application/json" \
  -H "X-Login: ${LOGIN}" \
  -H "X-Password: ${PASSWORD}" \
  -d "$JSON_DATA")

# Разделяем ответ и HTTP код
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo ""
echo "📥 Ответ сервера:"
echo "HTTP Status: ${HTTP_CODE}"
echo ""
echo "Body:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

# Анализ результата
if [ "$HTTP_CODE" = "201" ]; then
  echo "✅ Успешно! Заказ создан"
  exit 0
elif [ "$HTTP_CODE" = "401" ]; then
  if echo "$BODY" | grep -q "Требуется авторизация"; then
    echo "❌ Ошибка авторизации:"
    echo "   → Возможно, на сервере не развернута новая версия кода"
    echo "   → Или заголовки X-Login/X-Password не передаются"
    echo ""
    echo "🔍 Проверьте:"
    echo "   1. Выполните на сервере: git pull origin main"
    echo "   2. Перезапустите приложение: pm2 restart all"
    echo "   3. Проверьте логи сервера на наличие сообщений:"
    echo "      [API Auth] Используем авторизацию через заголовки X-Login/X-Password"
  elif echo "$BODY" | grep -q "Неверный логин или пароль"; then
    echo "❌ Неверные учетные данные"
  fi
  exit 1
elif [ "$HTTP_CODE" = "400" ]; then
  echo "⚠️  Ошибка валидации данных"
  exit 1
else
  echo "⚠️  Неожиданный статус: ${HTTP_CODE}"
  exit 1
fi

