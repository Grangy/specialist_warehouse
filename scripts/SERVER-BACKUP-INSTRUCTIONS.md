# Инструкция по резервному копированию на сервере

## Проблема: "Invalid value undefined for datasource"

Если вы видите ошибку `Invalid value undefined for datasource "db"`, это означает, что переменная `DATABASE_URL` не загружается из `.env` файла.

## Решение

### 1. Убедитесь, что .env файл существует в корне проекта

```bash
cd /opt/specialist_warehouse
ls -la .env
```

Если файла нет, создайте его:
```bash
echo 'DATABASE_URL="file:./prisma/dev.db"' > .env
```

### 2. Запустите скрипт из корня проекта (рекомендуется)

```bash
cd /opt/specialist_warehouse
npx tsx scripts/backup-database.ts
```

### 3. Или установите переменную окружения перед запуском

```bash
cd /opt/specialist_warehouse/scripts
export DATABASE_URL="file:../prisma/dev.db"
npx tsx backup-database.ts
```

### 4. Или используйте абсолютный путь в .env

```bash
# В файле .env укажите абсолютный путь:
DATABASE_URL="file:/opt/specialist_warehouse/prisma/dev.db"
```

## Проверка перед запуском

```bash
# 1. Перейдите в корень проекта
cd /opt/specialist_warehouse

# 2. Проверьте наличие .env файла
cat .env | grep DATABASE_URL

# 3. Проверьте наличие базы данных
ls -lh prisma/dev.db

# 4. Убедитесь, что Prisma Client сгенерирован
npx prisma generate

# 5. Запустите бэкап
npx tsx scripts/backup-database.ts
```

## Автоматическое резервное копирование

Добавьте в crontab для ежедневного бэкапа:

```bash
# Редактируем crontab
crontab -e

# Добавляем строку (каждый день в 3:00 ночи)
0 3 * * * cd /opt/specialist_warehouse && npx tsx scripts/backup-database.ts >> /var/log/backup.log 2>&1
```

## Восстановление

```bash
cd /opt/specialist_warehouse
npx tsx scripts/restore-database.ts backups/backup_YYYY-MM-DDTHH-MM-SS.json
```

## Отладка

Если скрипт не находит .env файл, проверьте:

```bash
# Показывает, где скрипт ищет .env
cd /opt/specialist_warehouse
npx tsx scripts/backup-database.ts 2>&1 | grep -E "(Поиск|Проект|База данных)"
```

Скрипт должен показать:
- Путь к проекту: `/opt/specialist_warehouse`
- Путь к .env файлу: `/opt/specialist_warehouse/.env`
- Путь к базе данных: `file:/opt/specialist_warehouse/prisma/dev.db`
