# Быстрый старт: Резервное копирование на сервере

## Проблема: "Cannot find module"

Если вы видите ошибку `Cannot find module '/opt/specialist_warehouse/src/generated/prisma/client'`, это означает, что вы пытаетесь запустить TypeScript файл через `node` напрямую.

## Решение

### Вариант 1: Использовать tsx (рекомендуется)

```bash
# Установите tsx глобально (если еще не установлен)
npm install -g tsx

# Запустите бэкап
tsx scripts/backup-database.ts
```

### Вариант 2: Использовать npx tsx (без глобальной установки)

```bash
npx tsx scripts/backup-database.ts
```

### Вариант 3: Использовать npm скрипт

```bash
npm run db:backup
```

### Вариант 4: Использовать bash скрипт (автоматически выберет tsx)

```bash
chmod +x scripts/backup-database-server.sh
./scripts/backup-database-server.sh
```

## Восстановление

```bash
# Через tsx
tsx scripts/restore-database.ts backups/backup_YYYY-MM-DDTHH-MM-SS.json

# Или через npm
npm run db:restore backups/backup_YYYY-MM-DDTHH-MM-SS.json
```

## Проверка перед запуском

Убедитесь, что:
1. Prisma Client сгенерирован: `npx prisma generate`
2. Переменная DATABASE_URL настроена в `.env`
3. База данных существует и доступна

## Пример полного процесса на сервере

```bash
# 1. Перейдите в директорию проекта
cd /opt/specialist_warehouse

# 2. Убедитесь, что Prisma Client сгенерирован
npx prisma generate

# 3. Создайте резервную копию
tsx scripts/backup-database.ts

# 4. Проверьте созданный бэкап
ls -lh backups/

# 5. При необходимости восстановите
tsx scripts/restore-database.ts backups/backup_YYYY-MM-DDTHH-MM-SS.json
```
