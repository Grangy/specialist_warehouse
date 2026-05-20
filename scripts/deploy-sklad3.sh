#!/bin/bash
# Деплой на сервер sklad3 (см. scripts/ssh-copy-id-shared-to-sklad3.sh): хост 91.215.60.44, пользователь grangy.
# Использование: ./scripts/deploy-sklad3.sh
# Переопределение: DEPLOY_PATH=/var/www/... SERVER_USER=root ./scripts/deploy-sklad3.sh
# (не используйте локальный $HOME в DEPLOY_PATH — путь должен быть тем, что на удалённой машине)
set -e
export SERVER_HOST="${SERVER_HOST:-91.215.60.44}"
export SERVER_USER="${SERVER_USER:-grangy}"
export DEPLOY_PATH="${DEPLOY_PATH:-/home/grangy/specialist_warehouse}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/deploy-remote.sh"
