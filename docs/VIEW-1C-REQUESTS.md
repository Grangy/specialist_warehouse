# 🔍 Просмотр запросов от 1С в консоли

Инструкция по просмотру запросов, которые делает 1С к вашему API, для диагностики проблем.

---

## 📋 Что логируется

Для каждого запроса от 1С логируется:

1. **Уникальный ID запроса** - для отслеживания конкретного запроса
2. **Время запроса** - точное время получения запроса
3. **IP адрес клиента** - откуда пришел запрос
4. **URL и метод** - какой endpoint запрашивается
5. **Заголовки** - все заголовки запроса (пароли скрыты)
6. **Тело запроса** - данные, отправленные 1С (пароли скрыты)
7. **Ответ сервера** - что отправляется обратно в 1С
8. **Ошибки** - если что-то пошло не так

---

## 🔧 Просмотр логов на сервере

### Вариант 1: PM2 (рекомендуется)

```bash
# Подключитесь к серверу
ssh root@77.222.47.184

# Просмотр логов в реальном времени
pm2 logs sklad-spec

# Просмотр только последних 100 строк
pm2 logs sklad-spec --lines 100

# Просмотр логов с фильтром по 1С
pm2 logs sklad-spec --lines 200 | grep -E "\[Sync-1C\]|\[Ready-For-Export\]"

# Очистка логов
pm2 flush sklad-spec
```

### Вариант 2: Systemd

```bash
# Просмотр логов в реальном времени
journalctl -u specialist-warehouse -f

# Просмотр последних 100 строк
journalctl -u specialist-warehouse -n 100

# Просмотр логов с фильтром по 1С
journalctl -u specialist-warehouse -n 200 | grep -E "\[Sync-1C\]|\[Ready-For-Export\]"

# Просмотр логов за последний час
journalctl -u specialist-warehouse --since "1 hour ago"
```

### Вариант 3: Прямой просмотр логов Next.js

```bash
# Если приложение запущено напрямую через npm start
# Логи будут выводиться в консоль, где запущено приложение
```

---

## 📊 Примеры логов

### Пример 1: Успешный запрос к sync-1c

```
================================================================================
[Sync-1C] [abc123] [2025-01-15T16:30:45.123Z] Входящий POST запрос от 1С
[Sync-1C] [abc123] IP адрес: 192.168.1.100
[Sync-1C] [abc123] URL: http://77.222.47.184:3000/api/shipments/sync-1c
[Sync-1C] [abc123] Метод: POST
[Sync-1C] [abc123] Заголовки: {
  "content-type": "application/json",
  "x-login": "admin",
  "x-password": "***HIDDEN***",
  "user-agent": "1C/8.3"
}
[Sync-1C] [abc123] Логин: admin
[Sync-1C] [abc123] Тело запроса: {
  "login": "admin",
  "password": "***HIDDEN***",
  "orders": [
    {
      "id": "shipment_id_123",
      "success": true
    }
  ]
}
[Sync-1C] [abc123] Количество orders в запросе: 1
[Sync-1C] [abc123] Заказ shipment_id_123 помечен как выгруженный в 1С
[Sync-1C] [abc123] Найдено готовых к выгрузке заказов: 2
[Sync-1C] [abc123] Отправляем ответ: {
  "orders_count": 2,
  "orders": [
    {
      "id": "shipment_id_456",
      "number": "ИПУТ-028140",
      "customer_name": "ООО Клиент",
      "items_count": 5,
      "total_qty": 25
    },
    {
      "id": "shipment_id_789",
      "number": "ИПУТ-028141",
      "customer_name": "ООО Другой Клиент",
      "items_count": 3,
      "total_qty": 15
    }
  ]
}
================================================================================
```

### Пример 2: Запрос к ready-for-export

```
================================================================================
[Ready-For-Export] [xyz789] [2025-01-15T16:31:00.456Z] Входящий GET запрос от 1С
[Ready-For-Export] [xyz789] IP адрес: 192.168.1.100
[Ready-For-Export] [xyz789] URL: http://77.222.47.184:3000/api/shipments/ready-for-export
[Ready-For-Export] [xyz789] Метод: GET
[Ready-For-Export] [xyz789] Заголовки: {
  "content-type": "application/json",
  "x-login": "admin",
  "x-password": "***HIDDEN***",
  "user-agent": "1C/8.3"
}
[Ready-For-Export] [xyz789] Найдено готовых к выгрузке заказов: 1
[Ready-For-Export] [xyz789] Отправляем ответ: {
  "count": 1,
  "orders": [
    {
      "id": "shipment_id_456",
      "number": "ИПУТ-028140",
      "customer_name": "ООО Клиент",
      "items_count": 5,
      "total_qty": 25
    }
  ]
}
================================================================================
```

### Пример 3: Ошибка в запросе

```
================================================================================
[Sync-1C] [def456] [2025-01-15T16:32:15.789Z] Входящий POST запрос от 1С
[Sync-1C] [def456] IP адрес: 192.168.1.100
[Sync-1C] [def456] URL: http://77.222.47.184:3000/api/shipments/sync-1c
[Sync-1C] [def456] Метод: POST
[Sync-1C] [def456] Заголовки: {
  "content-type": "application/json",
  "x-login": "admin",
  "x-password": "***HIDDEN***"
}
[Sync-1C] [def456] Тело запроса: {
  "login": "admin",
  "password": "***HIDDEN***",
  "orders": "не массив"
}
[Sync-1C] [def456] Количество orders в запросе: не массив
[Sync-1C] [def456] Ошибка синхронизации с 1С: Error: Неверный формат запроса
[Sync-1C] [def456] Сообщение ошибки: Неверный формат запроса. Ожидается массив orders
[Sync-1C] [def456] Стек ошибки: ...
================================================================================
```

---

## 🔍 Поиск конкретных запросов

### Найти все запросы от конкретного IP

```bash
pm2 logs sklad-spec --lines 1000 | grep "192.168.1.100"
```

### Найти все запросы к sync-1c

```bash
pm2 logs sklad-spec --lines 500 | grep "\[Sync-1C\]"
```

### Найти все запросы к ready-for-export

```bash
pm2 logs sklad-spec --lines 500 | grep "\[Ready-For-Export\]"
```

### Найти запросы с ошибками

```bash
pm2 logs sklad-spec --lines 500 | grep -E "Ошибка|Error|error"
```

### Найти запросы по номеру заказа

```bash
pm2 logs sklad-spec --lines 1000 | grep "ИПУТ-028140"
```

### Найти запросы за последний час

```bash
pm2 logs sklad-spec --lines 1000 | grep "$(date +%Y-%m-%d)"
```

---

## 📝 Сохранение логов в файл

### Сохранить все логи в файл

```bash
# Сохранить последние 1000 строк
pm2 logs sklad-spec --lines 1000 > /tmp/1c-requests-$(date +%Y%m%d_%H%M%S).log

# Или для systemd
journalctl -u specialist-warehouse -n 1000 > /tmp/1c-requests-$(date +%Y%m%d_%H%M%S).log
```

### Сохранить только запросы от 1С

```bash
pm2 logs sklad-spec --lines 2000 | grep -E "\[Sync-1C\]|\[Ready-For-Export\]" > /tmp/1c-only-$(date +%Y%m%d_%H%M%S).log
```

---

## 🐛 Диагностика проблем

### Проблема: 1С получает не те данные

1. **Найдите запрос в логах:**
   ```bash
   pm2 logs sklad-spec --lines 500 | grep -A 50 "\[Sync-1C\]"
   ```

2. **Проверьте, что отправляется в ответе:**
   - Найдите строку `Отправляем ответ:`
   - Проверьте поля `customer_name`, `number`, `collected_qty`

3. **Проверьте, что приходит в запросе:**
   - Найдите строку `Тело запроса:`
   - Проверьте формат данных

### Проблема: Ошибка авторизации

```bash
# Найдите запросы с ошибками авторизации
pm2 logs sklad-spec --lines 500 | grep -E "401|403|авторизац"
```

### Проблема: Неверный формат запроса

```bash
# Найдите запросы с ошибками формата
pm2 logs sklad-spec --lines 500 | grep -E "Неверный формат|400"
```

---

## 🔄 Мониторинг в реальном времени

### Создать скрипт для мониторинга

```bash
# Создайте файл /opt/specialist_warehouse/monitor-1c.sh
cat > /opt/specialist_warehouse/monitor-1c.sh << 'EOF'
#!/bin/bash
echo "Мониторинг запросов от 1С (Ctrl+C для выхода)"
pm2 logs sklad-spec --lines 0 | grep --line-buffered -E "\[Sync-1C\]|\[Ready-For-Export\]"
EOF

chmod +x /opt/specialist_warehouse/monitor-1c.sh
```

### Запуск мониторинга

```bash
/opt/specialist_warehouse/monitor-1c.sh
```

---

## 📊 Анализ логов

### Подсчет запросов за день

```bash
# Количество запросов к sync-1c
pm2 logs sklad-spec --lines 5000 | grep "\[Sync-1C\].*Входящий POST" | wc -l

# Количество запросов к ready-for-export
pm2 logs sklad-spec --lines 5000 | grep "\[Ready-For-Export\].*Входящий GET" | wc -l
```

### Найти самые частые IP адреса

```bash
pm2 logs sklad-spec --lines 5000 | grep "IP адрес:" | awk '{print $NF}' | sort | uniq -c | sort -rn
```

### Найти запросы с ошибками

```bash
pm2 logs sklad-spec --lines 5000 | grep -B 5 "Ошибка" | grep "\[Sync-1C\]\|\[Ready-For-Export\]"
```

---

## ⚙️ Настройка уровня логирования

Логирование включено по умолчанию. Если нужно отключить или изменить уровень:

1. **Отключить логирование** - закомментируйте строки с `console.log` в файлах:
   - `src/app/api/shipments/sync-1c/route.ts`
   - `src/app/api/shipments/ready-for-export/route.ts`

2. **Изменить формат логов** - отредактируйте строки логирования в этих же файлах

---

## 💡 Полезные команды

```bash
# Просмотр логов с временными метками
pm2 logs sklad-spec --timestamp

# Просмотр логов без цветов (для сохранения в файл)
pm2 logs sklad-spec --no-color --lines 500

# Просмотр логов за определенный период (systemd)
journalctl -u specialist-warehouse --since "2025-01-15 10:00:00" --until "2025-01-15 18:00:00"

# Поиск по содержимому запроса
pm2 logs sklad-spec --lines 1000 | grep -A 20 "ИПУТ-028140"
```

---

## 🔐 Безопасность

⚠️ **Важно:** Пароли в логах автоматически скрываются (`***HIDDEN***`), но:
- Не передавайте логи третьим лицам
- Регулярно очищайте старые логи
- Храните логи в безопасном месте

---

**Теперь вы можете видеть все запросы от 1С в реальном времени!**

