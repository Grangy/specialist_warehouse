#!/bin/bash

# Скрипт для создания кастомного заказа через curl
# Использование: ./scripts/curl-create-custom-order.sh

# Настройки
BASE_URL="${BASE_URL:-http://77.222.47.184:3000}"
API_URL="${BASE_URL}/api"
USERNAME="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-admin123}"

# Данные заказа (измените под свои нужды)
ORDER_NUMBER="${ORDER_NUMBER:-РН-$(date +%Y%m%d-%H%M%S)}"
CUSTOMER_NAME="${CUSTOMER_NAME:-ООО Моя Компания}"
DESTINATION="${DESTINATION:-Основной склад}"
BUSINESS_REGION="${BUSINESS_REGION:-Москва}"
COMMENT="${COMMENT:-Заказ создан через curl}"

echo "📦 Создание заказа с авторизацией в запросе..."
echo "URL: ${API_URL}"
echo "Пользователь: ${USERNAME}"
echo "Номер: ${ORDER_NUMBER}"
echo "Клиент: ${CUSTOMER_NAME}"
echo ""

# JSON данные для заказа с авторизацией
# Измените массив lines под свои товары
ORDER_JSON=$(cat <<EOF
{
  "login": "${USERNAME}",
  "password": "${PASSWORD}",
  "number": "${ORDER_NUMBER}",
  "customerName": "${CUSTOMER_NAME}",
  "destination": "${DESTINATION}",
  "itemsCount": 3,
  "totalQty": 25,
  "weight": 150.5,
  "comment": "${COMMENT}",
  "businessRegion": "${BUSINESS_REGION}",
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
EOF
)

# Создание заказа с авторизацией в теле запроса (без cookies)
CREATE_RESPONSE=$(curl -s -X POST "${API_URL}/shipments" \
  -H "Content-Type: application/json" \
  -d "${ORDER_JSON}")

echo "Ответ создания заказа:"
echo "${CREATE_RESPONSE}" | jq '.' 2>/dev/null || echo "${CREATE_RESPONSE}"

# Проверяем успешность создания
if echo "${CREATE_RESPONSE}" | grep -q '"id"'; then
  echo ""
  echo "✅ Заказ успешно создан!"
  
  # Извлекаем данные заказа
  ORDER_NUMBER_RESULT=$(echo "${CREATE_RESPONSE}" | jq -r '.shipment.number' 2>/dev/null)
  ORDER_ID=$(echo "${CREATE_RESPONSE}" | jq -r '.shipment.id' 2>/dev/null)
  
  if [ -n "${ORDER_NUMBER_RESULT}" ] && [ "${ORDER_NUMBER_RESULT}" != "null" ]; then
    echo "📋 Номер заказа: ${ORDER_NUMBER_RESULT}"
    echo "🆔 ID заказа: ${ORDER_ID}"
  fi
else
  echo ""
  echo "❌ Ошибка создания заказа"
  exit 1
fi

echo ""
echo "🎉 Готово!"


