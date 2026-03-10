#!/bin/bash
# Вызов автозавершения доп.работы в 18:00 МСК.
# Добавьте в crontab:
#   0 18 * * * /var/www/specialist_warehouse/scripts/cron-auto-stop-extra-work.sh
#
# Важно: серверный cron обычно в UTC. 18:00 МСК = 15:00 UTC.
#   0 15 * * * /var/www/specialist_warehouse/scripts/cron-auto-stop-extra-work.sh

set -e
cd "$(dirname "$0")/.."

# NVM/Node в PATH (если есть) — как в fix-collector-and-restore.sh
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
for d in /root/.nvm/versions/node/*/bin /usr/local/bin; do
  [ -x "$d/npx" ] && export PATH="$d:$PATH" && break
done

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -z "$CRON_SECRET" ]]; then
  echo "CRON_SECRET не задан в .env"
  exit 1
fi

# URL приложения (без /api на конце)
BASE="${API_BASE:-http://localhost:3000}"
BASE="${BASE%/api}"
URL="${BASE}/api/cron/auto-stop-extra-work?secret=${CRON_SECRET}"

curl -sS -X POST "$URL" || true
