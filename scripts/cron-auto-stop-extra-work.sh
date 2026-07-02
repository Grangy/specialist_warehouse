#!/bin/bash
# Вызов автозавершения доп.работы в 18:00 МСК.
# Моментально останавливает все активные сессии (running/lunch/lunch_scheduled)
# и фиксирует elapsedSecBeforeLunch для расчёта баллов.
#
# Добавьте в crontab:
#   Сервер в UTC:     0 15 * * *  (18:00 МСК)
#   Сервер в MSK:     0 18 * * *  (18:00 МСК)
#   cd /path/to/specialist_warehouse && ./scripts/cron-auto-stop-extra-work.sh >> logs/cron-auto-stop-extra-work.log 2>&1
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
RESP=$(curl -sS -X POST "$URL")
echo "$RESP" | jq . 2>/dev/null || echo "$RESP"
