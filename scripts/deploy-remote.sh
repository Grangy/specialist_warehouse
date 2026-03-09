#!/bin/bash
# Лёгкий деплой на сервер (77.222.52.31): git pull, миграции, build, pm2 restart
# Без npm install — запускай вручную при добавлении зависимостей
#
# Использование: ./scripts/deploy-remote.sh
#   С паролем: DEPLOY_PASSWORD='...' ./scripts/deploy-remote.sh
#   С ключом:  SSH_KEY=~/.ssh/key ./scripts/deploy-remote.sh
#
# Переменные: SERVER_USER, DEPLOY_PATH, DEPLOY_PASSWORD (или SSH_KEY)

set -e

SERVER_HOST="${SERVER_HOST:-77.222.52.31}"
SERVER_USER="${SERVER_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/var/www/specialist_warehouse}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/shared_server_key}"

if [ -n "$DEPLOY_PASSWORD" ]; then
  SSH_CMD=(sshpass -p "$DEPLOY_PASSWORD" ssh -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_HOST")
elif [ -f "$SSH_KEY" ]; then
  SSH_CMD=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SERVER_USER@$SERVER_HOST")
else
  echo "❌ Нужен SSH ключ ($SSH_KEY) или DEPLOY_PASSWORD"
  exit 1
fi

echo "🚀 Деплой на $SERVER_USER@$SERVER_HOST ($DEPLOY_PATH)"
echo ""

"${SSH_CMD[@]}" "DEPLOY_PATH='$DEPLOY_PATH' bash -s" << 'REMOTE'
set -e
cd "$DEPLOY_PATH" || { echo "❌ Директория не найдена: $DEPLOY_PATH"; exit 1; }

# nvm (если есть)
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
[ -s "/root/.nvm/nvm.sh" ] && . "/root/.nvm/nvm.sh"

echo "📥 git pull..."
git pull origin main

echo "🗄️ Миграции..."
npx prisma migrate deploy

echo "🏗️ Сборка..."
npm run build

echo "🔄 pm2 restart..."
pm2 restart specialist-warehouse

echo ""
echo "✅ Деплой завершён"
pm2 status
REMOTE

echo ""
echo "✅ Готово."
