#!/bin/bash

# Тестовый скрипт для проверки авторизации в API

BASE_URL="${BASE_URL:-http://77.222.47.184:3000}"
API_URL="${BASE_URL}/api"
USERNAME="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-admin123}"

echo "🧪 Тестирование API создания заказа с авторизацией в запросе"
echo "URL: ${API_URL}/shipments"
echo ""

# Тестовый запрос с авторизацией в теле
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${API_URL}/shipments" \
  -H "Content-Type: application/json" \
  -d "{
    \"login\": \"${USERNAME}\",
    \"password\": \"${PASSWORD}\",
    \"number\": \"РН-TEST-$(date +%s)\",
    \"customerName\": \"Тестовая компания\",
    \"destination\": \"Основной склад\",
    \"businessRegion\": \"Москва\",
    \"comment\": \"Тестовый заказ\",
    \"lines\": [
      {
        \"sku\": \"TEST-001\",
        \"name\": \"Тестовый товар 1\",
        \"qty\": 5,
        \"uom\": \"шт\",
        \"location\": \"Стеллаж A / Полка 1\",
        \"warehouse\": \"Склад 1\"
      }
    ]
  }")

# Разделяем ответ и HTTP код
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo "HTTP Status: ${HTTP_CODE}"
echo ""
echo "Response:"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
echo ""

if [ "$HTTP_CODE" = "201" ] || echo "$BODY" | grep -q '"success":true'; then
  echo "✅ Успешно! API работает с авторизацией в запросе"
  exit 0
else
  echo "❌ Ошибка! Проверьте:"
  echo "  1. Развернута ли новая версия на сервере"
  echo "  2. Правильные ли credentials (login: ${USERNAME})"
  echo "  3. Логи сервера для деталей"
  exit 1
fi

