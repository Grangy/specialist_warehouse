#!/bin/bash
# Лёгкий деплой на сервер (77.222.52.31): git pull, миграции, build, pm2 restart
# Без npm install — запускай вручную при добавлении зависимостей
#
# Использование: ./scripts/deploy-remote.sh
# Или: git push && ./scripts/deploy-remote.sh
#
# Требует: SSH ключ ~/.ssh/shared_server_key
# Переменные: SERVER_USER (по умолчанию root), DEPLOY_PATH (путь к проекту на сервере)

set -e

SERVER_HOST="${SERVER_HOST:-77.222.52.31}"
SERVER_USER="${SERVER_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-~/sklad_spec}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/shared_server_key}"

if [ ! -f "$SSH_KEY" ]; then
  echo "❌ SSH ключ не найден: $SSH_KEY"
  echo "   Укажите путь: SSH_KEY=/path/to/key $0"
  exit 1
fi

echo "🚀 Деплой на $SERVER_USER@$SERVER_HOST ($DEPLOY_PATH)"
echo ""

ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_HOST" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" << 'REMOTE'
set -e
cd "$DEPLOY_PATH" || { echo "❌ Директория не найдена: $DEPLOY_PATH"; exit 1; }

echo "📥 git pull..."
git pull origin main

echo "🗄️ Миграции..."
npx prisma migrate deploy

echo "🏗️ Сборка..."
npm run build

echo "🔄 pm2 restart..."
pm2 restart sklad-spec || pm2 start npm --name "sklad-spec" -- start

echo ""
echo "✅ Деплой завершён"
pm2 status
REMOTE

echo ""
echo "✅ Готово."
