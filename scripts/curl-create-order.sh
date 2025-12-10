#!/bin/bash

# Скрипт для создания тестового заказа через curl
# Использование: ./scripts/curl-create-order.sh

# Настройки
BASE_URL="${BASE_URL:-http://localhost:3000}"
API_URL="${BASE_URL}/api"
USERNAME="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-YOUR_PASSWORD}"

echo "🔐 Авторизация..."
echo "URL: ${API_URL}"
echo "Пользователь: ${USERNAME}"
echo ""

# Шаг 1: Авторизация
LOGIN_RESPONSE=$(curl -s -c /tmp/cookies.txt -X POST "${API_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"login\":\"${USERNAME}\",\"password\":\"${PASSWORD}\"}")

echo "Ответ авторизации: ${LOGIN_RESPONSE}"
echo ""

# Проверяем успешность авторизации
if echo "${LOGIN_RESPONSE}" | grep -q '"success":true'; then
  echo "✅ Авторизация успешна"
else
  echo "❌ Ошибка авторизации"
  echo "${LOGIN_RESPONSE}"
  exit 1
fi

# Шаг 2: Создание тестового заказа через специальный endpoint
echo ""
echo "📦 Создание тестового заказа..."
echo ""

CREATE_RESPONSE=$(curl -s -b /tmp/cookies.txt -X POST "${API_URL}/shipments/create-test" \
  -H "Content-Type: application/json")

echo "Ответ создания заказа:"
echo "${CREATE_RESPONSE}" | jq '.' 2>/dev/null || echo "${CREATE_RESPONSE}"

# Проверяем успешность создания
if echo "${CREATE_RESPONSE}" | grep -q '"success":true'; then
  echo ""
  echo "✅ Заказ успешно создан!"
  
  # Извлекаем номер заказа
  ORDER_NUMBER=$(echo "${CREATE_RESPONSE}" | jq -r '.shipment.number' 2>/dev/null)
  if [ -n "${ORDER_NUMBER}" ] && [ "${ORDER_NUMBER}" != "null" ]; then
    echo "📋 Номер заказа: ${ORDER_NUMBER}"
  fi
else
  echo ""
  echo "❌ Ошибка создания заказа"
  exit 1
fi

# Очистка
rm -f /tmp/cookies.txt

echo ""
echo "🎉 Готово!"



