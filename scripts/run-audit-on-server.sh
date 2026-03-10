#!/bin/bash
# Полный аудит производительности на сервере.
# 1) Нагрузочный тест (audit:db-load) — метрики за время
# 2) Полный отчёт (audit:full) — .md с рекомендациями
#
# Использование на сервере:
#   cd /var/www/specialist_warehouse
#   source ~/.nvm/nvm.sh   # если npm не в PATH
#   ./scripts/run-audit-on-server.sh
#
# Опции (env):
#   AUDIT_DURATION=300   — длительность нагрузочного теста (сек)
#   AUDIT_VERBOSE=1      — подробный вывод
#   AUDIT_EXPORT=1       — экспорт JSON нагрузочного теста
#   AUDIT_DIR=/path      — папка для отчётов
#   AUDIT_FULL_ONLY=1    — только полный отчёт .md (без нагрузочного теста)

set -e

cd "$(dirname "$0")/.."
AUDIT_DIR="${AUDIT_DIR:-$(pwd)/audit-reports}"
DURATION="${AUDIT_DURATION:-300}"
VERBOSE="${AUDIT_VERBOSE:-}"
EXPORT="${AUDIT_EXPORT:-}"
FULL_ONLY="${AUDIT_FULL_ONLY:-}"

mkdir -p "$AUDIT_DIR"
TS=$(date +%Y%m%d_%H%M%S)

echo "=============================================="
echo "Аудит производительности — $(date -Iseconds)"
echo "=============================================="
echo ""

# 1. Полный отчёт в .md (быстро, всегда)
REPORT_FILE="$AUDIT_DIR/PERFORMANCE-AUDIT-$TS.md"
echo "[1/2] Полный отчёт: $REPORT_FILE"
npm run audit:full -- --duration=30 --report="$REPORT_FILE" 2>&1
echo ""

# 2. Нагрузочный тест (если не FULL_ONLY)
if [ -z "$FULL_ONLY" ]; then
  LOG_FILE="$AUDIT_DIR/audit-db-load-$TS.log"
  JSON_FILE="$AUDIT_DIR/audit-db-load-$TS.json"
  ARGS="--duration=$DURATION"
  [ -n "$VERBOSE" ] && ARGS="$ARGS --verbose"
  [ -n "$EXPORT" ] && ARGS="$ARGS --export=$JSON_FILE"

  echo "[2/2] Нагрузочный тест (${DURATION} сек): $LOG_FILE"
  npm run audit:db-load -- $ARGS 2>&1 | tee "$LOG_FILE"
  [ -n "$EXPORT" ] && [ -f "$JSON_FILE" ] && echo "JSON: $JSON_FILE"
else
  echo "[2/2] Нагрузочный тест пропущен (AUDIT_FULL_ONLY=1)"
fi

echo ""
echo "Готово. Отчёт: $REPORT_FILE"
