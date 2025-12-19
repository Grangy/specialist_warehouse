#!/bin/bash
# Скрипт для применения миграции поля deleted на сервере

set -e

echo "🔍 Диагностика базы данных..."

# Находим путь к базе данных из .env
if [ -f .env ]; then
    DB_PATH=$(grep -E '^DATABASE_URL=' .env | cut -d '=' -f2 | sed 's|file:||' | sed 's|^\./||')
else
    DB_PATH="prisma/dev.db"
fi

# Если путь относительный, делаем его абсолютным
if [[ ! "$DB_PATH" =~ ^/ ]]; then
    DB_PATH="$(pwd)/$DB_PATH"
fi

echo "📁 Путь к базе данных: $DB_PATH"

# Проверяем, существует ли база данных
if [ ! -f "$DB_PATH" ]; then
    echo "❌ База данных не найдена по пути: $DB_PATH"
    echo "🔍 Ищем базу данных..."
    find . -name "*.db" -type f 2>/dev/null | head -5
    exit 1
fi

echo "✅ База данных найдена"

# Проверяем структуру таблицы
echo ""
echo "📊 Текущая структура таблицы shipments:"
sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" || {
    echo "❌ Ошибка при чтении структуры таблицы shipments"
    echo "🔍 Проверяем список таблиц:"
    sqlite3 "$DB_PATH" ".tables"
    exit 1
}

# Проверяем, есть ли уже поле deleted
if sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" | grep -q "deleted"; then
    echo ""
    echo "✅ Поле deleted уже существует"
else
    echo ""
    echo "➕ Добавляем поле deleted..."
    sqlite3 "$DB_PATH" "ALTER TABLE shipments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;"
    echo "✅ Поле deleted добавлено"
fi

# Проверяем, есть ли уже поле deleted_at
if sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует"
else
    echo "➕ Добавляем поле deleted_at..."
    sqlite3 "$DB_PATH" "ALTER TABLE shipments ADD COLUMN deleted_at TEXT;"
    echo "✅ Поле deleted_at добавлено"
fi

echo ""
echo "📋 Финальная структура таблицы shipments:"
sqlite3 "$DB_PATH" "PRAGMA table_info(shipments);"

echo ""
echo "🔄 Генерируем Prisma Client..."
npx prisma generate

echo ""
echo "✅ Миграция применена успешно!"
echo ""
echo "📝 Следующие шаги:"
echo "   1. npm run build"
echo "   2. pm2 restart sklad-spec"

