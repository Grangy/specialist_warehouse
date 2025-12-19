#!/bin/bash
# Скрипт для исправления ошибки с полем deleted на сервере

set -e

echo "🔍 Проверяем структуру базы данных..."

# Находим путь к базе данных
DB_PATH=$(grep -E '^DATABASE_URL=' .env | cut -d '=' -f2 | sed 's/file://' | sed 's|^\./||')

if [ -z "$DB_PATH" ]; then
    DB_PATH="prisma/dev.db"
fi

echo "📁 Путь к базе данных: $DB_PATH"

# Проверяем, существует ли база данных
if [ ! -f "$DB_PATH" ]; then
    echo "❌ База данных не найдена по пути: $DB_PATH"
    exit 1
fi

echo "📊 Проверяем текущую структуру таблицы shipments..."

# Проверяем, какие таблицы есть в базе
sqlite3 "$DB_PATH" ".tables" | grep -i shipment || echo "⚠️  Таблица shipments не найдена"

# Проверяем, есть ли уже поле deleted
if sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" | grep -q "deleted"; then
    echo "✅ Поле deleted уже существует в таблице shipments"
else
    echo "➕ Добавляем поле deleted в таблицу shipments..."
    
    # Получаем схему таблицы для понимания структуры
    sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);"
    
    # Добавляем поле deleted
    sqlite3 "$DB_PATH" <<EOF
-- Добавляем поле deleted, если его еще нет
ALTER TABLE shipments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
EOF
    
    echo "✅ Поле deleted добавлено"
fi

# Проверяем, есть ли уже поле deleted_at
if sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует в таблице shipments"
else
    echo "➕ Добавляем поле deleted_at в таблицу shipments..."
    
    sqlite3 "$DB_PATH" <<EOF
-- Добавляем поле deleted_at, если его еще нет
ALTER TABLE shipments ADD COLUMN deleted_at TEXT;
EOF
    
    echo "✅ Поле deleted_at добавлено"
fi

echo ""
echo "📋 Проверяем структуру таблицы после изменений:"
sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" | grep -E "(deleted|name)"

echo ""
echo "🔄 Генерируем Prisma Client..."
npx prisma generate

echo ""
echo "✅ Готово! Теперь пересоберите проект:"
echo "   npm run build"
echo "   pm2 restart sklad-spec"

