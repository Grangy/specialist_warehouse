#!/bin/bash

# Скрипт для безопасного деплоя новой версии
# Использование: ./deploy.sh

set -e  # Остановка при ошибке

echo "🚀 Начинаем деплой новой версии..."

# 1. Бэкап БД (храним последние 10 копий dev.db.backup.*)
echo "📦 Создаем бэкап базы данных..."
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "⚠️  БД не найдена, пропускаем бэкап"
# Оставляем только последние 10 копий dev.db.backup.*
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

# 8. (Опционально) Проверка производительности доп. работы
# npm run recalc:extra-work

# 9. Перезапуск приложения
echo "🔄 Перезапускаем приложение..."
pm2 restart sklad-spec || pm2 start npm --name "sklad-spec" -- start

# 10. Проверка статуса
echo "✅ Деплой завершен!"
echo ""
echo "📊 Статус приложения:"
pm2 status
echo ""
echo "📝 Последние логи:"
pm2 logs sklad-spec --lines 20 --nostream

