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

## Что экспортируется

Скрипт экспортирует следующие данные:

1. **Заказы (Shipments)**
   - Все заказы со статусами: `new`, `pending_confirmation`, `processed`
   - Полная информация о каждом заказе

2. **Пользователи (Users)**
   - Все пользователи системы
   - Роли, логины, имена

3. **Статистика (Statistics)**
   - Общая статистика (`/api/statistics/overview`)
   - Рейтинги за сегодня, неделю, месяц (`/api/statistics/ranking`)

4. **Аналитика (Analytics)**
   - Аналитика сборщиков (`/api/analytics/collectors`)
   - Аналитика проверяльщиков (`/api/analytics/checkers`)
   - Аналитика всех пользователей (`/api/analytics/all-users`)

5. **Регионы (Regions)**
   - Список регионов (`/api/regions/list`)
   - Приоритеты регионов (`/api/regions/priorities`)

## Структура экспорта

После выполнения скрипта создается директория с временной меткой:

```
exports/
  export_2026-01-26_12-30-45/
    full_export.json      # Все данные в одном файле
    shipments.json        # Только заказы
    users.json            # Только пользователи
    statistics.json       # Только статистика
    analytics.json        # Только аналитика
    regions.json          # Только регионы
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
  --password admin123
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
export API_PASSWORD="your_password"

npx tsx scripts/export-data-via-api.ts \
  --url "$API_URL" \
  --login "$API_LOGIN" \
  --password "$API_PASSWORD"
```

Или создайте файл `.env.local`:

```env
API_URL=https://sklad.specialist82.pro
API_LOGIN=admin
API_PASSWORD=your_password
```

И используйте `dotenv-cli`:

```bash
npx dotenv -e .env.local -- npx tsx scripts/export-data-via-api.ts \
  --url "$API_URL" \
  --login "$API_LOGIN" \
  --password "$API_PASSWORD"
```
