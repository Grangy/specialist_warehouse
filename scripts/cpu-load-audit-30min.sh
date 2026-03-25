#!/usr/bin/env bash
# 30-минутный аудит нагрузки CPU: периодические снимки процессов, load, память.
# Не останавливает PM2/Node — только читает состояние системы.
#
# Переменные окружения:
#   CPU_AUDIT_DURATION   — секунды (по умолчанию 1800 = 30 мин)
#   CPU_AUDIT_INTERVAL   — интервал между сэмплами, сек (по умолчанию 20)
#   CPU_AUDIT_OUT        — каталог отчётов (по умолчанию ./audit-reports или текущая)
#
# Запуск в фоне на сервере:
#   nohup ./scripts/cpu-load-audit-30min.sh >> /tmp/cpu-audit-nohup.log 2>&1 &
#   echo $!

set -euo pipefail

DURATION_SEC="${CPU_AUDIT_DURATION:-1800}"
INTERVAL="${CPU_AUDIT_INTERVAL:-20}"
OUT_DIR="${CPU_AUDIT_OUT:-$(cd "$(dirname "$0")/.." && pwd)/audit-reports}"
mkdir -p "$OUT_DIR"

TS="$(date +%Y%m%d_%H%M%S)"
LOG="${OUT_DIR}/cpu-load-audit-${TS}.log"
SUMMARY="${OUT_DIR}/cpu-load-audit-${TS}-summary.txt"
HIGHCPU="${OUT_DIR}/cpu-load-audit-${TS}-highcpu.tsv"

START_EPOCH="$(date +%s)"
END_EPOCH=$((START_EPOCH + DURATION_SEC))

{
  echo "=== CPU load audit ==="
  echo "Start: $(date -Iseconds) (epoch=$START_EPOCH)"
  echo "Duration: ${DURATION_SEC}s | Sample interval: ${INTERVAL}s"
  echo "Host: $(hostname 2>/dev/null || echo unknown)"
  echo "Kernel: $(uname -a 2>/dev/null || true)"
  echo "CPUs: $(nproc 2>/dev/null || echo '?')"
  echo "Log file: $LOG"
  echo ""
} | tee -a "$LOG"

sample_id=0
while [ "$(date +%s)" -lt "$END_EPOCH" ]; do
  sample_id=$((sample_id + 1))
  {
    echo "######## SAMPLE $sample_id @ $(date -Iseconds) ########"
    echo "--- uptime / load ---"
    uptime
    echo "--- /proc/loadavg ---"
    cat /proc/loadavg 2>/dev/null || true
    echo "--- top 1 snapshot (batch) ---"
    if command -v top >/dev/null 2>&1; then
      COLUMNS=200 top -b -n 1 -o %CPU 2>/dev/null | head -n 45 || top -b -n 1 2>/dev/null | head -n 45 || true
    fi
    echo "--- ps: highest CPU (top 35 by %cpu) ---"
    ps -eo pid,pcpu,pmem,rss,args --sort=-pcpu 2>/dev/null | head -n 36 || ps aux --sort=-%cpu 2>/dev/null | head -n 36 || true
    echo "--- node / next / pm2 processes (if any) ---"
    ps aux 2>/dev/null | grep -E '[n]ode|[n]ext|pm2' || true
    echo "--- vmstat 1 3 ---"
    if command -v vmstat >/dev/null 2>&1; then
      vmstat 1 3 2>/dev/null || true
    fi
    echo ""
  } >> "$LOG"

  sleep "$INTERVAL" || true
done

{
  echo "=== END $(date -Iseconds) ==="
  echo "Total samples: $sample_id"
} | tee -a "$LOG"

# --- Итог: строки только из блока ps (top по CPU), считаем частоту команды и max %cpu ---
awk '
  /^--- ps: highest CPU/ { inps=1; next }
  inps && /^--- vmstat/ { inps=0; next }
  inps && /^PID/ { next }
  inps && $1 ~ /^[0-9]+$/ && NF >= 5 {
    pcpu = $2 + 0
    cmd = ""
    for (i = 5; i <= NF; i++) cmd = cmd (i > 5 ? " " : "") $i
    gsub(/^.*\//, "", cmd)
    key = substr(cmd, 1, 72)
    cnt[key]++
    if (pcpu > maxp[key]) maxp[key] = pcpu
  }
  END {
    for (k in cnt) print cnt[k] "\t" maxp[k] "\t" k
  }
' "$LOG" | sort -t'	' -k1,1nr | head -50 > "$HIGHCPU" || true

{
  echo "=== Сводка CPU audit ==="
  echo "Файл лога: $LOG"
  echo "Сэмплов: $sample_id"
  echo ""
  echo "--- Топ команд по числу попаданий в верхнюю часть списка ps (грубая оценка) ---"
  cat "$HIGHCPU" 2>/dev/null || echo "(не удалось построить)"
  echo ""
  echo "--- Рекомендации (эвристика) ---"
  if grep -qE 'next-server|node.*sklad|node.*next' "$HIGHCPU" 2>/dev/null; then
    echo "- В топе часто Node/Next — типично для приложения; смотрите пики в логе по SAMPLE и корреляцию с запросами."
  fi
  if grep -qE 'prisma|sqlite' "$LOG" 2>/dev/null; then
    echo "- Упоминания prisma/sqlite в процессах — проверьте тяжёлые запросы (PRISMA_LOG_SLOW_MS)."
  fi
  echo "- Сравните SAMPLE с моментами высокого load в uptime внутри $LOG"
  echo "- Если лидирует системный процесс — искать внешние факторы (бэкап, cron, другой сервис)."
} | tee "$SUMMARY"

echo "Готово: $LOG"
echo "Сводка: $SUMMARY"
echo "Топ CPU (tsv): $HIGHCPU"
