#!/bin/bash

# Тестовый скрипт для проверки API локально

BASE_URL="${BASE_URL:-http://localhost:3000}"
API_URL="${BASE_URL}/api"
USERNAME="${ADMIN_USERNAME:-admin}"
PASSWORD="${ADMIN_PASSWORD:-YOUR_PASSWORD}"

echo "🧪 Тестирование API создания заказа"
echo "URL: ${API_URL}/shipments"
echo "Login: ${USERNAME}"
echo ""

# Тест 1: Проверка с авторизацией в теле запроса
echo "📋 Тест 1: Запрос с login/password в теле"
RESPONSE1=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${API_URL}/shipments" \
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
        \"name\": \"Тестовый товар\",
        \"qty\": 5,
        \"uom\": \"шт\",
        \"location\": \"Стеллаж A / Полка 1\",
        \"warehouse\": \"Склад 1\"
      }
    ]
  }")

HTTP_CODE1=$(echo "$RESPONSE1" | grep "HTTP_CODE:" | cut -d: -f2)
BODY1=$(echo "$RESPONSE1" | sed '/HTTP_CODE:/d')

echo "HTTP Status: ${HTTP_CODE1}"
echo "Response:"
echo "$BODY1" | jq '.' 2>/dev/null || echo "$BODY1"
echo ""

if [ "$HTTP_CODE1" = "201" ] || echo "$BODY1" | grep -q '"success":true'; then
  echo "✅ Тест 1 пройден: API работает с авторизацией в запросе"
else
  echo "❌ Тест 1 не пройден"
  if echo "$BODY1" | grep -q "Требуется авторизация"; then
    echo "   → Возможно, на сервере старая версия кода"
  fi
fi

echo ""
echo "📋 Тест 2: Запрос БЕЗ login/password (должен требовать авторизацию)"
RESPONSE2=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${API_URL}/shipments" \
  -H "Content-Type: application/json" \
  -d "{
    \"number\": \"РН-TEST-$(date +%s)\",
    \"customerName\": \"Тестовая компания\",
    \"destination\": \"Основной склад\",
    \"lines\": [
      {
        \"sku\": \"TEST-001\",
        \"name\": \"Тестовый товар\",
        \"qty\": 5,
        \"uom\": \"шт\"
      }
    ]
  }")

HTTP_CODE2=$(echo "$RESPONSE2" | grep "HTTP_CODE:" | cut -d: -f2)
BODY2=$(echo "$RESPONSE2" | sed '/HTTP_CODE:/d')

echo "HTTP Status: ${HTTP_CODE2}"
if [ "$HTTP_CODE2" = "401" ]; then
  echo "✅ Тест 2 пройден: API правильно требует авторизацию"
else
  echo "⚠️  Тест 2: Неожиданный статус (ожидался 401)"
fi

echo ""
echo "📋 Тест 3: Проверка валидации (неполные данные)"
RESPONSE3=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "${API_URL}/shipments" \
  -H "Content-Type: application/json" \
  -d "{
    \"login\": \"${USERNAME}\",
    \"password\": \"${PASSWORD}\",
    \"number\": \"РН-TEST-$(date +%s)\"
  }")

HTTP_CODE3=$(echo "$RESPONSE3" | grep "HTTP_CODE:" | cut -d: -f2)
BODY3=$(echo "$RESPONSE3" | sed '/HTTP_CODE:/d')

echo "HTTP Status: ${HTTP_CODE3}"
if [ "$HTTP_CODE3" = "400" ]; then
  echo "✅ Тест 3 пройден: API правильно валидирует данные"
else
  echo "⚠️  Тест 3: Неожиданный статус (ожидался 400)"
fi

echo ""
echo "🎯 Итоги:"
if [ "$HTTP_CODE1" = "201" ] || echo "$BODY1" | grep -q '"success":true'; then
  echo "✅ API работает корректно!"
  exit 0
else
  echo "❌ API не работает. Проверьте:"
  echo "   1. Запущен ли сервер на ${BASE_URL}"
  echo "   2. Развернута ли новая версия кода"
  echo "   3. Существует ли пользователь ${USERNAME} в БД"
  echo "   4. Логи сервера для деталей"
  exit 1
fi

