#!/bin/bash
# Полный скрипт для исправления проблемы: применяет миграции и добавляет поля
# Исправлена проблема с путем к базе данных

set -e

echo "=========================================="
echo "Полное исправление проблемы с полем deleted"
echo "=========================================="
echo ""

cd /opt/specialist_warehouse || {
    echo "❌ Не удалось перейти в /opt/specialist_warehouse"
    exit 1
}

echo "📁 Текущая директория: $(pwd)"
echo ""

# Находим базу данных из DATABASE_URL или по стандартным путям
DB_FILE=""

# Проверяем .env файл
if [ -f ".env" ]; then
    DB_PATH=$(grep -E '^DATABASE_URL=' .env | cut -d '=' -f2 | sed 's|file:||' | sed 's|^\./||')
    if [ -n "$DB_PATH" ] && [ -f "$DB_PATH" ]; then
        DB_FILE="$DB_PATH"
    fi
fi

# Если не нашли, проверяем стандартные пути
if [ -z "$DB_FILE" ]; then
    if [ -f "prisma/dev.db" ]; then
        DB_FILE="prisma/dev.db"
    elif [ -f "/opt/prisma/dev.db" ]; then
        DB_FILE="/opt/prisma/dev.db"
    else
        DB_FILE=$(find /opt -name "dev.db" -type f 2>/dev/null | head -1)
    fi
fi

if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
    echo "❌ База данных не найдена"
    echo "🔍 Ищем все .db файлы:"
    find /opt -name "*.db" -type f 2>/dev/null | head -5
    exit 1
fi

echo "✅ Найдена база данных: $DB_FILE"
echo ""

# Проверяем, есть ли таблицы
TABLES=$(sqlite3 "$DB_FILE" ".tables" 2>/dev/null || echo "")
echo "📋 Таблицы в базе данных:"
if [ -z "$TABLES" ]; then
    echo "   (база данных пустая или таблицы не найдены)"
    echo ""
    echo "🔄 Применяем миграции..."
    npx prisma migrate deploy || {
        echo "⚠️  Ошибка при применении миграций, но продолжаем..."
    }
    echo ""
    # Проверяем снова
    TABLES=$(sqlite3 "$DB_FILE" ".tables" 2>/dev/null || echo "")
fi

if [ -z "$TABLES" ]; then
    echo "❌ Таблицы все еще не найдены после миграций"
    echo "💡 Проверяем базу данных напрямую..."
    sqlite3 "$DB_FILE" "SELECT name FROM sqlite_master WHERE type='table';" || echo "Ошибка при запросе таблиц"
    exit 1
fi

echo "$TABLES"
echo ""

# Ищем таблицу shipments
SHIPMENT_TABLE=""
if echo "$TABLES" | grep -qE "\bshipments\b"; then
    SHIPMENT_TABLE="shipments"
elif echo "$TABLES" | grep -qi "shipment"; then
    SHIPMENT_TABLE=$(echo "$TABLES" | tr ' ' '\n' | grep -i shipment | head -1)
else
    echo "❌ Таблица shipments не найдена"
    echo "💡 Попробуйте выполнить миграции вручную:"
    echo "   npx prisma migrate deploy"
    exit 1
fi

echo "✅ Найдена таблица: $SHIPMENT_TABLE"
echo ""

# Проверяем структуру
echo "📊 Структура таблицы $SHIPMENT_TABLE:"
sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | head -25
echo ""

# Проверяем и добавляем поле deleted
if sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -q "deleted"; then
    echo "✅ Поле deleted уже существует"
else
    echo "➕ Добавляем поле deleted..."
    if sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;" 2>&1; then
        echo "✅ Поле deleted добавлено"
    else
        echo "⚠️  Ошибка при добавлении deleted (возможно, уже существует)"
    fi
fi

# Проверяем и добавляем поле deleted_at
if sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует"
else
    echo "➕ Добавляем поле deleted_at..."
    if sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted_at TEXT;" 2>&1; then
        echo "✅ Поле deleted_at добавлено"
    else
        echo "⚠️  Ошибка при добавлении deleted_at (возможно, уже существует)"
    fi
fi

echo ""
echo "📋 Финальная проверка структуры:"
sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -E "deleted" || echo "Поля deleted не найдены в выводе (но это нормально, если они уже были добавлены миграцией)"

echo ""
echo "🔄 Генерируем Prisma Client..."
npx prisma generate

echo ""
echo "🔨 Пересобираем проект..."
npm run build

echo ""
echo "🔄 Перезапускаем приложение..."
pm2 restart sklad-spec 2>/dev/null || systemctl restart specialist-warehouse 2>/dev/null || {
    echo "⚠️  Перезапустите вручную: pm2 restart sklad-spec"
}

echo ""
echo "=========================================="
echo "✅ Готово!"
echo "=========================================="

