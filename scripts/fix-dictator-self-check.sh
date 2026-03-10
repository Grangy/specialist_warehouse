#!/bin/bash
# Исправление: удаление баллов за диктовку при самопроверке (checker=dictator).
# Запуск на сервере: ssh root@77.222.52.31 "cd /var/www/specialist_warehouse && ./scripts/fix-dictator-self-check.sh"
# Или локально с деплоем: ./scripts/deploy-and-fix-dictator.sh

set -e
cd "$(dirname "$0")/.."

[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
for d in /root/.nvm/versions/node/*/bin /usr/local/bin; do
  [ -x "$d/npx" ] && export PATH="$d:$PATH" && break
done

echo "=== 1. git pull (код с фиксом dictator) ==="
git pull origin main

echo ""
echo "=== 2. Пересчёт баллов (удаляет dictator TS при самопроверке) ==="
npm run stats:recalc-points -- --apply

echo ""
echo "=== 3. Перезапуск приложения ==="
pm2 restart specialist-warehouse 2>/dev/null || pm2 restart 0 2>/dev/null || true

echo ""
echo "✅ Готово. Баллы за диктовку при самопроверке (Эрнес и др.) исключены."
