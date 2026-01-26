#!/bin/bash

# Скрипт для создания резервной копии на сервере
# Использование: ./scripts/backup-database-server.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🔄 Создание резервной копии базы данных..."

# Проверяем наличие tsx
if command -v tsx &> /dev/null; then
    echo "✓ Используем tsx для запуска TypeScript скрипта"
    tsx scripts/backup-database.ts
elif command -v npx &> /dev/null; then
    echo "✓ Используем npx tsx для запуска TypeScript скрипта"
    npx tsx scripts/backup-database.ts
else
    echo "❌ tsx не найден. Установите tsx: npm install -g tsx"
    echo "   Или используйте: npm run db:backup"
    exit 1
fi
