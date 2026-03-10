#!/bin/bash
# Деплой + пересчёт баллов (фикс dictator при самопроверке) на сервере.
# Использование: ./scripts/deploy-and-fix-dictator.sh
#   SSH_KEY=~/.ssh/key ./scripts/deploy-and-fix-dictator.sh
#   DEPLOY_PASSWORD='...' ./scripts/deploy-and-fix-dictator.sh

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

echo "🚀 Подключение к $SERVER_USER@$SERVER_HOST — деплой + пересчёт dictator"
echo ""

"${SSH_CMD[@]}" "cd $DEPLOY_PATH && ./scripts/fix-dictator-self-check.sh"

echo ""
echo "✅ Готово."
