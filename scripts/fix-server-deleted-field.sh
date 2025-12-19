#!/bin/bash
# Простой скрипт для исправления проблемы с полем deleted на сервере
# Использование: bash scripts/fix-server-deleted-field.sh

set -e

echo "=========================================="
echo "Исправление проблемы с полем deleted"
echo "=========================================="
echo ""

cd /opt/specialist_warehouse || {
    echo "❌ Не удалось перейти в /opt/specialist_warehouse"
    exit 1
}

echo "📁 Текущая директория: $(pwd)"
echo ""

# Находим базу данных
DB_FILE=""
if [ -f "prisma/dev.db" ]; then
    DB_FILE="prisma/dev.db"
elif [ -f ".next/cache/prisma/dev.db" ]; then
    DB_FILE=".next/cache/prisma/dev.db"
else
    # Ищем базу данных
    DB_FILE=$(find . -name "*.db" -type f 2>/dev/null | grep -E "(dev|prod|database)" | head -1)
fi

if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
    echo "❌ База данных не найдена"
    echo "🔍 Ищем все .db файлы:"
    find . -name "*.db" -type f 2>/dev/null || echo "Файлы .db не найдены"
    exit 1
fi

echo "✅ Найдена база данных: $DB_FILE"
echo ""

# Проверяем, существует ли таблица shipments
if ! sqlite3 "$DB_FILE" ".tables" | grep -q "shipments"; then
    echo "❌ Таблица shipments не найдена"
    echo "📋 Список таблиц:"
    sqlite3 "$DB_FILE" ".tables"
    exit 1
fi

echo "✅ Таблица shipments найдена"
echo ""

# Проверяем текущую структуру
echo "📊 Текущая структура таблицы shipments:"
sqlite3 "$DB_FILE" "PRAGMA table_info(shipments);" | head -20
echo ""

# Проверяем, есть ли поле deleted
if sqlite3 "$DB_FILE" "PRAGMA table_info(shipments);" | grep -q "deleted"; then
    echo "✅ Поле deleted уже существует"
    DELETED_EXISTS=true
else
    echo "➕ Добавляем поле deleted..."
    sqlite3 "$DB_FILE" "ALTER TABLE shipments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;" 2>&1 || {
        echo "⚠️  Возможно поле уже существует, продолжаем..."
    }
    DELETED_EXISTS=false
fi

# Проверяем, есть ли поле deleted_at
if sqlite3 "$DB_FILE" "PRAGMA table_info(shipments);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует"
    DELETED_AT_EXISTS=true
else
    echo "➕ Добавляем поле deleted_at..."
    sqlite3 "$DB_FILE" "ALTER TABLE shipments ADD COLUMN deleted_at TEXT;" 2>&1 || {
        echo "⚠️  Возможно поле уже существует, продолжаем..."
    }
    DELETED_AT_EXISTS=false
fi

echo ""
echo "📋 Проверяем результат:"
sqlite3 "$DB_FILE" "PRAGMA table_info(shipments);" | grep -E "(deleted|name)" || echo "Поля не найдены в выводе"

echo ""
echo "🔄 Генерируем Prisma Client..."
npx prisma generate

echo ""
echo "🔨 Пересобираем проект..."
npm run build

echo ""
echo "🔄 Перезапускаем приложение..."
pm2 restart sklad-spec || systemctl restart specialist-warehouse || {
    echo "⚠️  Не удалось перезапустить автоматически, сделайте это вручную:"
    echo "   pm2 restart sklad-spec"
    echo "   или"
    echo "   systemctl restart specialist-warehouse"
}

echo ""
echo "=========================================="
echo "✅ Готово! Проблема должна быть исправлена"
echo "=========================================="
echo ""
echo "📝 Проверьте логи:"
echo "   pm2 logs sklad-spec --lines 50"
echo ""

