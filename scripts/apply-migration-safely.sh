#!/bin/bash

# Скрипт для безопасного применения миграций на сервере
# Использование: ./scripts/apply-migration-safely.sh

set -e  # Остановка при ошибке

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Безопасное применение миграций на сервере ===${NC}\n"

# Определяем директорию скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo -e "${YELLOW}Шаг 1: Создание резервной копии базы данных${NC}"
echo "Создаем полный бэкап перед применением миграций..."
if command -v tsx &> /dev/null; then
    tsx scripts/backup-database.ts
elif command -v npx &> /dev/null; then
    npx tsx scripts/backup-database.ts
else
    echo -e "${RED}✗ tsx не найден. Установите: npm install -g tsx${NC}"
    exit 1
fi

if [ $? -ne 0 ]; then
    echo -e "${RED}✗ Ошибка при создании резервной копии!${NC}"
    echo -e "${RED}   Миграции НЕ будут применены.${NC}"
    exit 1
fi

echo -e "\n${GREEN}✓ Резервная копия создана${NC}\n"

echo -e "${YELLOW}Шаг 2: Проверка статуса миграций${NC}"
npx prisma migrate status

echo -e "\n${YELLOW}Шаг 3: Просмотр миграций, которые будут применены${NC}"
echo "Следующие миграции будут применены:"
npx prisma migrate status 2>&1 | grep -A 20 "Following migration" || echo "Все миграции применены"

echo -e "\n${YELLOW}Шаг 4: Применение миграций${NC}"
echo -e "${RED}⚠️  ВНИМАНИЕ: Сейчас будут применены миграции к базе данных!${NC}"
read -p "Продолжить? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo -e "${YELLOW}Миграции отменены${NC}"
    exit 0
fi

echo -e "\n${GREEN}Применяем миграции...${NC}"
npx prisma migrate deploy

if [ $? -eq 0 ]; then
    echo -e "\n${GREEN}✓ Миграции успешно применены!${NC}"
    
    echo -e "\n${YELLOW}Шаг 5: Проверка структуры базы данных${NC}"
    npx prisma db pull --print 2>&1 | head -20 || echo "Проверка завершена"
    
    echo -e "\n${GREEN}✅ Все готово!${NC}"
    echo -e "${YELLOW}Резервная копия сохранена в: $PROJECT_ROOT/backups/${NC}"
else
    echo -e "\n${RED}✗ Ошибка при применении миграций!${NC}"
    echo -e "${YELLOW}Для восстановления используйте:${NC}"
    echo "  npx tsx scripts/restore-database.ts backups/backup_YYYY-MM-DDTHH-MM-SS.json"
    exit 1
fi
