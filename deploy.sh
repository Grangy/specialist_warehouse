#!/bin/bash

# Скрипт для безопасного деплоя новой версии
# Использование: ./deploy.sh

set -e  # Остановка при ошибке

echo "🚀 Начинаем деплой новой версии..."

# 1. Бэкап БД (VACUUM INTO для WAL, храним последние 10 копий)
echo "📦 Создаем бэкап базы данных..."
mkdir -p backups
npm run db:backup:db-only -- backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "⚠️  Бэкап не удался, пропускаем"
if [ -d backups ]; then
  (cd backups && ls -t dev.db.backup.* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null) || true
fi

# 2. Остановка приложения
echo "⏸️  Останавливаем приложение..."
pm2 stop sklad-spec 2>/dev/null || echo "⚠️  PM2 не запущен или приложение не найдено"

# 3. Обновление кода
echo "📥 Обновляем код из Git..."
git fetch origin
git checkout main
git pull origin main

# 4. Установка зависимостей
echo "📦 Устанавливаем зависимости..."
npm install

# 5. Применение миграций
echo "🗄️  Применяем миграции базы данных..."
npx prisma migrate deploy

# 6. Регенерация Prisma Client
echo "🔧 Регенерируем Prisma Client..."
npx prisma generate

# 7. Сборка проекта
echo "🏗️  Собираем проект..."
npm run build

# 8. Подготовка доп. работы: ставка 09:00–09:15 из истории
echo "📊 Подготовка доп. работы..."
npx tsx scripts/compute-startup-rate-09-00.ts 30 --save || true

# 9. Перезапуск приложения (reload для загрузки нового кода)
echo "🔄 Перезапускаем приложение..."
pm2 reload sklad-spec 2>/dev/null || pm2 restart sklad-spec 2>/dev/null || pm2 start npm --name "sklad-spec" -- start

# 10. Проверка статуса
echo "✅ Деплой завершен!"
echo ""
echo "📊 Статус приложения:"
pm2 status
echo ""
echo "📝 Последние логи:"
pm2 logs sklad-spec --lines 20 --nostream
echo ""
echo "💡 Автозавершение доп.работы в 18:00 МСК: добавьте в crontab (15:00 UTC = 18:00 МСК):"
echo "   0 15 * * * cd /var/www/specialist_warehouse && ./scripts/cron-auto-stop-extra-work.sh"
echo "   Требуется CRON_SECRET в .env"

