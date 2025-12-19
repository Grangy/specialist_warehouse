#!/bin/bash
# Улучшенный скрипт для исправления проблемы с полем deleted на сервере
# Проверяет все таблицы и находит правильное имя

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

# Получаем список всех таблиц
echo "📋 Все таблицы в базе данных:"
TABLES=$(sqlite3 "$DB_FILE" ".tables")
echo "$TABLES"
echo ""

# Ищем таблицу shipments (может быть с префиксом или другим именем)
SHIPMENT_TABLE=""
if echo "$TABLES" | grep -qE "\bshipments\b"; then
    SHIPMENT_TABLE="shipments"
elif echo "$TABLES" | grep -qi "shipment"; then
    # Находим таблицу, содержащую shipment
    SHIPMENT_TABLE=$(echo "$TABLES" | tr ' ' '\n' | grep -i shipment | head -1)
    echo "✅ Найдена таблица: $SHIPMENT_TABLE"
else
    echo "❌ Таблица shipments не найдена"
    echo ""
    echo "🔍 Проверяем структуру базы данных..."
    echo ""
    echo "📊 Информация о базе данных:"
    sqlite3 "$DB_FILE" "SELECT name FROM sqlite_master WHERE type='table';"
    echo ""
    echo "⚠️  Возможно, база данных пустая или таблицы еще не созданы"
    echo "💡 Попробуйте выполнить миграции:"
    echo "   npx prisma migrate deploy"
    exit 1
fi

echo "✅ Используем таблицу: $SHIPMENT_TABLE"
echo ""

# Проверяем текущую структуру
echo "📊 Текущая структура таблицы $SHIPMENT_TABLE:"
sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | head -25
echo ""

# Проверяем, есть ли поле deleted
if sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -q "deleted"; then
    echo "✅ Поле deleted уже существует"
else
    echo "➕ Добавляем поле deleted..."
    if sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;" 2>&1; then
        echo "✅ Поле deleted добавлено"
    else
        echo "⚠️  Ошибка при добавлении поля deleted, но продолжаем..."
    fi
fi

# Проверяем, есть ли поле deleted_at
if sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -q "deleted_at"; then
    echo "✅ Поле deleted_at уже существует"
else
    echo "➕ Добавляем поле deleted_at..."
    if sqlite3 "$DB_FILE" "ALTER TABLE $SHIPMENT_TABLE ADD COLUMN deleted_at TEXT;" 2>&1; then
        echo "✅ Поле deleted_at добавлено"
    else
        echo "⚠️  Ошибка при добавлении поля deleted_at, но продолжаем..."
    fi
fi

echo ""
echo "📋 Проверяем результат:"
sqlite3 "$DB_FILE" "PRAGMA table_info($SHIPMENT_TABLE);" | grep -E "(deleted|^[0-9]+)" | head -5

echo ""
echo "🔄 Генерируем Prisma Client..."
npx prisma generate

echo ""
echo "🔨 Пересобираем проект..."
npm run build

echo ""
echo "🔄 Перезапускаем приложение..."
pm2 restart sklad-spec 2>/dev/null || systemctl restart specialist-warehouse 2>/dev/null || {
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

