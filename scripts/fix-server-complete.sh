#!/bin/bash
# Полный скрипт для исправления проблемы: применяет миграции и добавляет поля

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

# Находим базу данных
DB_FILE="prisma/dev.db"
if [ ! -f "$DB_FILE" ]; then
    DB_FILE=$(find . -name "*.db" -type f 2>/dev/null | head -1)
fi

if [ -z "$DB_FILE" ] || [ ! -f "$DB_FILE" ]; then
    echo "❌ База данных не найдена"
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
    echo "💡 Попробуйте выполнить вручную:"
    echo "   npx prisma migrate deploy"
    echo "   npx prisma generate"
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
    sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;" && \
        echo "✅ Поле deleted добавлено" || \
        echo "⚠️  Ошибка при добавлении deleted"
fi

# Проверяем и добавляем поле deleted_at
if sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует"
else
    echo "➕ Добавляем поле deleted_at..."
    sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted_at TEXT;" && \
        echo "✅ Поле deleted_at добавлено" || \
        echo "⚠️  Ошибка при добавлении deleted_at"
fi

echo ""
echo "📋 Финальная проверка:"
sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -E "deleted" || echo "Поля deleted не найдены"

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

