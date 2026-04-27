#!/bin/bash
# Деплой на сервер sklad3 (см. разговор): по умолчанию 91.215.60.44, тот же репо и шаги, что в deploy-remote.sh
# Использование: ./scripts/deploy-sklad3.sh
# Переопределение: SERVER_HOST=... DEPLOY_PATH=... ./scripts/deploy-sklad3.sh
set -e
export SERVER_HOST="${SERVER_HOST:-91.215.60.44}"
export DEPLOY_PATH="${DEPLOY_PATH:-$HOME/specialist_warehouse}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/deploy-remote.sh"
