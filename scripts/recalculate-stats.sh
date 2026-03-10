#!/bin/bash
# Перерасчёт статистики: TaskStatistics (баллы), DailyStats, MonthlyStats, ранги.
#
# Использование:
#   ./scripts/recalculate-stats.sh          — dry-run (просмотр без записи)
#   ./scripts/recalculate-stats.sh --apply  — применить перерасчёт в БД
#
# После изменения коэффициентов в Настройках запускайте с --apply.

set -e
cd "$(dirname "$0")/.."

echo "📊 Перерасчёт статистики"
echo "========================"

if [[ "$1" == "--apply" ]]; then
  echo "Режим: применение изменений в БД"
  npx tsx scripts/recalculate-points-positions-only.ts --apply
else
  echo "Режим: dry-run (без записи). Для применения добавьте --apply"
  npx tsx scripts/recalculate-points-positions-only.ts
fi

echo ""
echo "✅ Готово."
