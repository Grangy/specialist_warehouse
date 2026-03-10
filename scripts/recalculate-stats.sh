#!/bin/bash
# Перерасчёт статистики: TaskStatistics (баллы), DailyStats, MonthlyStats, ранги.
#
# Использование:
#   ./scripts/recalculate-stats.sh          — dry-run (просмотр без записи)
#   ./scripts/recalculate-stats.sh --apply  — применить перерасчёт в БД
#
# После изменения коэффициентов в Настройках запускайте с --apply.
# Требуется DATABASE_URL в .env или в окружении.

set -e
cd "$(dirname "$0")/.."

# Загружаем .env (для cron/systemd, где переменные окружения могут быть не заданы)
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -z "$DATABASE_URL" ]]; then
  echo "❌ DATABASE_URL не задан. Создайте .env с DATABASE_URL=file:./prisma/dev.db"
  exit 1
fi

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
