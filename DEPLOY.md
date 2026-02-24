# 🚀 Инструкция по деплою

## Быстрый деплой (автоматический)

На сервере в каталоге проекта выполните:

```bash
./deploy.sh
```

Скрипт:
1. Создаст бэкап БД → `backups/dev.db.backup.YYYYMMDD_HHMMSS`
2. Остановит приложение (PM2)
3. Обновит код из Git (`git pull origin main`)
4. Установит зависимости (`npm install`)
5. Применит миграции (`npx prisma migrate deploy`)
6. Регенерирует Prisma Client
7. Соберёт проект (`npm run build`)
8. Перезапустит приложение (PM2)

---

## Ручной деплой

Если нужно выполнить шаги по отдельности:

```bash
# 1. Остановить приложение
pm2 stop sklad-spec

# 2. Обновить код
git fetch origin
git checkout main
git pull origin main

# 3. Установить зависимости
npm install

# 4. Применить миграции (обязательно!)
npx prisma migrate deploy

# 5. Регенерировать Prisma Client
npx prisma generate

# 6. Собрать проект
npm run build

# 7. Запустить приложение
pm2 restart sklad-spec
```

---

## Миграции базы данных

### Применение миграций на продакшене

```bash
npx prisma migrate deploy
```

Эта команда:
- Применяет все неприменённые миграции из `prisma/migrations/`
- Использует `DATABASE_URL` из `.env`
- Безопасна для продакшена (не создаёт новые миграции)

### Проверка статуса миграций

```bash
npx prisma migrate status
```

Покажет:
- Какие миграции применены
- Какие ожидают применения

### Создание новой миграции (только в разработке)

```bash
npx prisma migrate dev --name add_some_feature
```

⚠️ **Не используйте на продакшене** — эта команда может изменить схему. Создавайте миграции локально, коммитьте в Git, затем на сервере применяйте через `migrate deploy`.

---

## Переменные окружения

Скопируйте `.env.example` в `.env` и заполните:

```bash
cp .env.example .env
```

Минимально необходимые переменные:

```env
DATABASE_URL="file:./prisma/dev.db"
```

Для PWA через HTTP (локальная сеть):

```env
NEXT_PUBLIC_DISABLE_SECURE_COOKIE=true
```

---

## PM2

Запуск приложения:

```bash
pm2 start npm --name "sklad-spec" -- start
```

Перезапуск после деплоя:

```bash
pm2 restart sklad-spec
```

Просмотр логов:

```bash
pm2 logs sklad-spec
```

Сохранить текущий список процессов для автозапуска при перезагрузке сервера:

```bash
pm2 save
pm2 startup
```
