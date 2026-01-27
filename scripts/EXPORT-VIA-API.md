# Экспорт данных через API

Этот скрипт позволяет экспортировать все данные с сервера через API, даже если SSH/VNC недоступны.

## Использование

### Базовое использование

```bash
npx tsx scripts/export-data-via-api.ts \
  --url https://sklad.specialist82.pro \
  --login admin \
  --password YOUR_PASSWORD
```

### С указанием директории для экспорта

```bash
npx tsx scripts/export-data-via-api.ts \
  --url https://sklad.specialist82.pro \
  --login admin \
  --password YOUR_PASSWORD \
  --output ./my-exports
```

### Без деталей заказов (быстрее)

Если заказов очень много, можно пропустить экспорт деталей каждого заказа:

```bash
npx tsx scripts/export-data-via-api.ts \
  --url https://sklad.specialist82.pro \
  --login admin \
  --password YOUR_PASSWORD \
  --skip-details
```

## Что экспортируется

Скрипт экспортирует **ВСЕ** доступные данные через API:

1. **Заказы (Shipments)**
   - Все заказы со статусами: `new`, `pending_confirmation`, `processed`
   - Полная информация о каждом заказе
   - **Детали каждого заказа** (`/api/shipments/[id]/details`) - полная информация о заданиях, сборщиках, проверяльщиках, позициях

2. **Пользователи (Users)**
   - Все пользователи системы
   - Роли, логины, имена
   - **Детальная статистика каждого пользователя** (`/api/statistics/user/[userId]`) - TaskStatistics, DailyStats, MonthlyStats

3. **Статистика (Statistics)**
   - Общая статистика (`/api/statistics/overview`)
   - Рейтинги за сегодня, неделю, месяц (`/api/statistics/ranking`)
   - Рейтинги сборщиков, проверяльщиков и диктовщиков

4. **Аналитика (Analytics)**
   - Аналитика сборщиков (`/api/analytics/collectors`)
   - Аналитика проверяльщиков (`/api/analytics/checkers`)
   - Аналитика всех пользователей (`/api/analytics/all-users`)
   - **Общая аналитика** (`/api/analytics/overview`) - статистика по регионам, складам, временным метрикам

5. **Регионы (Regions)**
   - Список регионов (`/api/regions/list`)
   - Приоритеты регионов (`/api/regions/priorities`)
   - **Статистика по регионам** (`/api/shipments/regions-stats`) - активные сборки по регионам

6. **Настройки системы (Settings)**
   - Все системные настройки (`/api/settings`)

7. **Заказы готовые к экспорту**
   - Заказы готовые к выгрузке в 1С (`/api/shipments/ready-for-export`)

## Структура экспорта

После выполнения скрипта создается директория с временной меткой:

```
exports/
  export_2026-01-26_12-30-45/
    full_export.json          # Все данные в одном файле
    shipments.json            # Только заказы (базовая информация)
    shipment-details.json     # Детальная информация по каждому заказу
    users.json                # Только пользователи
    user-statistics.json      # Детальная статистика каждого пользователя
    statistics.json           # Только статистика
    analytics.json            # Только аналитика (сборщики, проверяльщики, все)
    analytics-overview.json   # Общая аналитика (регионы, склады, метрики)
    regions.json              # Только регионы
    settings.json             # Настройки системы
    ready-for-export.json     # Заказы готовые к экспорту в 1С
```

## Авторизация

Скрипт использует авторизацию через заголовки `X-Login` и `X-Password`, которые поддерживаются API.

Если авторизация через заголовки не работает, скрипт попробует авторизоваться через `/api/auth/login`.

## Требования

- Node.js 18+
- Доступ к интернету
- Валидные учетные данные администратора

## Примеры использования

### Экспорт с локального сервера

```bash
npx tsx scripts/export-data-via-api.ts \
  --url http://localhost:3000 \
  --login admin \
  --password YOUR_PASSWORD
```

### Экспорт с продакшн сервера

```bash
npx tsx scripts/export-data-via-api.ts \
  --url https://sklad.specialist82.pro \
  --login admin \
  --password YOUR_SECURE_PASSWORD
```

## Восстановление данных

После экспорта вы можете:

1. Использовать данные для анализа
2. Импортировать в локальную БД (если нужно)
3. Создать резервную копию

## Безопасность

⚠️ **Важно**: Не храните пароли в истории командной строки!

Используйте переменные окружения:

```bash
export API_URL="https://sklad.specialist82.pro"
export API_LOGIN="admin"
export API_PASSWORD="YOUR_PASSWORD"

npx tsx scripts/export-data-via-api.ts \
  --url "$API_URL" \
  --login "$API_LOGIN" \
  --password "$API_PASSWORD"
```

Или создайте файл `.env.local`:

```env
API_URL=https://sklad.specialist82.pro
API_LOGIN=admin
API_PASSWORD=YOUR_PASSWORD
```

И используйте `dotenv-cli`:

```bash
npx dotenv -e .env.local -- npx tsx scripts/export-data-via-api.ts \
  --url "$API_URL" \
  --login "$API_LOGIN" \
  --password "$API_PASSWORD"
```
