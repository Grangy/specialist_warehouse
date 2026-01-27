#!/bin/bash

# Скрипт для удаления паролей из истории Git
# ⚠️ ВНИМАНИЕ: Это перезапишет историю Git!
# Убедитесь, что все участники проекта синхронизированы перед выполнением

set -e

echo "🔒 Удаление паролей из истории Git"
echo "⚠️  ВНИМАНИЕ: Это перезапишет историю Git!"
echo ""
read -p "Вы уверены? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Отменено."
    exit 1
fi

# Список файлов, которые могут содержать пароли
FILES_TO_CLEAN=(
    "scripts/verify-import.ts"
    "scripts/import-data-from-api.ts"
    "scripts/export-data-via-api.ts"
    "scripts/import-data-from-api-old.ts"
    "prisma/seed.ts"
)

# Список паролей для поиска и замены
PASSWORDS_TO_REMOVE=(
    "admin123"
    "password"
    "admin"
)

echo ""
echo "📋 Шаг 1: Создание резервной копии..."
git branch backup-before-cleanup-$(date +%Y%m%d-%H%M%S)

echo ""
echo "📋 Шаг 2: Удаление паролей из истории..."

# Используем git filter-branch для каждого файла
for file in "${FILES_TO_CLEAN[@]}"; do
    if [ -f "$file" ]; then
        echo "  Обработка: $file"
        git filter-branch --force --index-filter \
            "git rm --cached --ignore-unmatch '$file' 2>/dev/null || true" \
            --prune-empty --tag-name-filter cat -- --all 2>/dev/null || true
    fi
done

echo ""
echo "📋 Шаг 3: Очистка истории..."

# Очистка reflog
git reflog expire --expire=now --all

# Агрессивная сборка мусора
git gc --prune=now --aggressive

echo ""
echo "✅ Готово!"
echo ""
echo "📝 Следующие шаги:"
echo "1. Проверьте историю: git log --all"
echo "2. Если все в порядке, отправьте изменения:"
echo "   git push --force --all"
echo "   git push --force --tags"
echo ""
echo "⚠️  ВНИМАНИЕ: После force push все участники должны:"
echo "   git fetch origin"
echo "   git reset --hard origin/main"
