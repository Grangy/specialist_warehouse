#!/bin/bash
# Вызов автозавершения доп.работы в 18:00 МСК.
# Моментально останавливает все активные сессии (running/lunch/lunch_scheduled)
# и фиксирует elapsedSecBeforeLunch для расчёта баллов.
#
# Добавьте в crontab (18:00 МСК = 15:00 UTC):
#   0 15 * * * cd /var/www/specialist_warehouse && ./scripts/cron-auto-stop-extra-work.sh
#
# Тест без изменений (dry run):
#   ./scripts/cron-auto-stop-extra-work.sh dry

set -e
cd "$(dirname "$0")/.."

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
[[ "$1" == "dry" ]] && URL="${URL}&dry=1"

echo "$(date -Iseconds) Вызов: $URL"
curl -sS -X POST "$URL" | jq . 2>/dev/null || curl -sS -X POST "$URL"
