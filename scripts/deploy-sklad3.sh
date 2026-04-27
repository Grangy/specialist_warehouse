#!/bin/bash
# Деплой на сервер sklad3 (см. разговор): по умолчанию 91.215.60.44, те же шаги, что в deploy-remote.sh
# Использование: ./scripts/deploy-sklad3.sh
# Переопределение: DEPLOY_PATH=/var/www/... ./scripts/deploy-sklad3.sh
# (не используйте локальный $HOME — путь должен быть тем, что на удалённой машине)
set -e
export SERVER_HOST="${SERVER_HOST:-91.215.60.44}"
export DEPLOY_PATH="${DEPLOY_PATH:-/root/specialist_warehouse}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/deploy-remote.sh"
