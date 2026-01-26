#!/bin/bash

# Скрипт для создания резервной копии базы данных
# Использование: ./scripts/backup-database.sh

set -e  # Остановка при ошибке

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Создание резервной копии базы данных ===${NC}"

# Определяем директорию скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Загружаем переменные окружения
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | grep DATABASE_URL | xargs)
    echo -e "${GREEN}✓ Загружены переменные из .env${NC}"
elif [ -f "$PROJECT_ROOT/.env.local" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env.local" | grep DATABASE_URL | xargs)
    echo -e "${GREEN}✓ Загружены переменные из .env.local${NC}"
else
    echo -e "${YELLOW}⚠ Файл .env не найден, используем переменные окружения${NC}"
fi

# Получаем DATABASE_URL
DATABASE_URL="${DATABASE_URL:-file:./prisma/dev.db}"

echo -e "${YELLOW}DATABASE_URL: $DATABASE_URL${NC}"

# Извлекаем путь к базе данных
if [[ "$DATABASE_URL" == file:* ]]; then
    DB_PATH="${DATABASE_URL#file:}"
    
    # Если относительный путь, делаем его абсолютным
    if [[ "$DB_PATH" == ./* ]]; then
        DB_PATH="$PROJECT_ROOT/${DB_PATH#./}"
    elif [[ "$DB_PATH" != /* ]]; then
        DB_PATH="$PROJECT_ROOT/$DB_PATH"
    fi
else
    echo -e "${RED}✗ Ошибка: DATABASE_URL должен начинаться с 'file:'${NC}"
    exit 1
fi

# Проверяем существование базы данных
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}✗ Ошибка: База данных не найдена по пути: $DB_PATH${NC}"
    exit 1
fi

echo -e "${GREEN}✓ База данных найдена: $DB_PATH${NC}"

# Создаем директорию для бэкапов
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"

# Генерируем имя файла бэкапа с временной меткой
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_NAME=$(basename "$DB_PATH")
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_backup_${TIMESTAMP}.db"
SQL_DUMP_FILE="$BACKUP_DIR/${DB_NAME}_dump_${TIMESTAMP}.sql"

echo -e "${YELLOW}Создание резервной копии...${NC}"

# Создаем копию базы данных
cp "$DB_PATH" "$BACKUP_FILE"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Резервная копия создана: $BACKUP_FILE${NC}"
    
    # Получаем размер файла
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}  Размер: $BACKUP_SIZE${NC}"
else
    echo -e "${RED}✗ Ошибка при создании резервной копии${NC}"
    exit 1
fi

# Создаем SQL дамп для дополнительной безопасности
echo -e "${YELLOW}Создание SQL дампа...${NC}"

if command -v sqlite3 &> /dev/null; then
    sqlite3 "$DB_PATH" .dump > "$SQL_DUMP_FILE"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ SQL дамп создан: $SQL_DUMP_FILE${NC}"
        
        # Получаем размер файла
        DUMP_SIZE=$(du -h "$SQL_DUMP_FILE" | cut -f1)
        echo -e "${GREEN}  Размер: $DUMP_SIZE${NC}"
    else
        echo -e "${YELLOW}⚠ Предупреждение: Не удалось создать SQL дамп (sqlite3 не найден)${NC}"
    fi
else
    echo -e "${YELLOW}⚠ Предупреждение: sqlite3 не установлен, SQL дамп не создан${NC}"
fi

# Создаем файл с информацией о бэкапе
INFO_FILE="$BACKUP_DIR/backup_info_${TIMESTAMP}.txt"
cat > "$INFO_FILE" << EOF
Резервная копия базы данных
============================
Дата создания: $(date)
Исходный путь: $DB_PATH
Резервная копия: $BACKUP_FILE
SQL дамп: $SQL_DUMP_FILE
Размер БД: $(du -h "$DB_PATH" | cut -f1)
Размер бэкапа: $BACKUP_SIZE
Размер дампа: ${DUMP_SIZE:-N/A}

Информация о базе данных:
$(sqlite3 "$DB_PATH" << 'SQL'
SELECT 'Users: ' || COUNT(*) FROM users;
SELECT 'Shipments: ' || COUNT(*) FROM shipments WHERE deleted=0;
SELECT 'Tasks: ' || COUNT(*) FROM shipment_tasks;
SELECT 'Task Statistics: ' || COUNT(*) FROM task_statistics;
SQL
)

Для восстановления:
1. Остановите приложение
2. Скопируйте файл бэкапа: cp $BACKUP_FILE $DB_PATH
3. Или восстановите из SQL дампа: sqlite3 $DB_PATH < $SQL_DUMP_FILE
4. Запустите приложение
EOF

echo -e "${GREEN}✓ Информация о бэкапе сохранена: $INFO_FILE${NC}"

# Показываем список последних бэкапов
echo ""
echo -e "${GREEN}=== Последние резервные копии ===${NC}"
ls -lht "$BACKUP_DIR"/*.db 2>/dev/null | head -5 | awk '{print $9, "(" $5 ")"}' || echo "Бэкапы не найдены"

echo ""
echo -e "${GREEN}✓ Резервное копирование завершено успешно!${NC}"
echo -e "${YELLOW}  Бэкапы сохранены в: $BACKUP_DIR${NC}"
