#!/bin/bash
# Восстановление сборок: backfill + recalculate (с фиксом) + ранги
# Запуск на сервере: ./scripts/fix-collector-and-restore.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 1. git pull (фикс recalculate) ==="
git pull origin main

echo ""
echo "=== 2. Backfill collector TaskStatistics ==="
npx tsx scripts/backfill-collector-stats.ts --today --workers 8 --apply

echo ""
echo "=== 3. Пересчёт баллов (не удаляет collector) ==="
npm run stats:recalculate -- --apply

echo ""
echo "=== 4. Пересчёт рангов ==="
npx tsx scripts/recalculate-ranks.ts

echo ""
echo "=== 5. Перезапуск приложения ==="
pm2 restart 0 2>/dev/null || true

echo ""
echo "=== 6. Аудит Игорь/Эрнес ==="
npm run audit:igor-ernes

echo ""
echo "✅ Готово."
