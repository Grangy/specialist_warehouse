# Руководство по безопасному применению миграций на сервере

## ⚠️ ВАЖНО: Всегда создавайте резервную копию перед миграциями!

## Пошаговая инструкция

### Шаг 1: Подключитесь к серверу

```bash
ssh root@your-server
cd /opt/specialist_warehouse
```

### Шаг 2: Создайте резервную копию базы данных

```bash
# Вариант 1: Через скрипт (рекомендуется)
npx tsx scripts/backup-database.ts

# Вариант 2: Через npm
npm run db:backup

# Вариант 3: Через bash скрипт
./scripts/backup-database-server.sh
```

**Проверьте, что бэкап создан:**
```bash
ls -lh backups/ | tail -3
```

### Шаг 3: Проверьте статус миграций

```bash
npx prisma migrate status
```

Эта команда покажет:
- Какие миграции уже применены
- Какие миграции ожидают применения
- Состояние базы данных

### Шаг 4: Просмотрите миграции, которые будут применены

```bash
# Посмотрите список миграций
ls -la prisma/migrations/

# Посмотрите содержимое последней миграции (если нужно)
cat prisma/migrations/YYYYMMDDHHMMSS_migration_name/migration.sql
```

### Шаг 5: Остановите приложение (если запущено)

```bash
# Остановите Next.js сервер
pm2 stop all
# или
systemctl stop your-app-service
# или просто Ctrl+C если запущено в терминале
```

### Шаг 6: Примените миграции

```bash
# Для продакшена используйте migrate deploy (не создает новые миграции)
npx prisma migrate deploy

# Или используйте автоматический скрипт
./scripts/apply-migration-safely.sh
```

**Что делает `migrate deploy`:**
- Применяет только непримененные миграции
- Не создает новые миграции
- Безопасен для продакшена

### Шаг 7: Перегенерируйте Prisma Client

```bash
npx prisma generate
```

### Шаг 8: Проверьте, что все работает

```bash
# Проверьте структуру базы данных
npx prisma db pull --print | head -30

# Или через Prisma Studio (опционально)
npx prisma studio
```

### Шаг 9: Запустите приложение

```bash
# Запустите Next.js сервер
pm2 start all
# или
systemctl start your-app-service
# или
npm run start
```

### Шаг 10: Проверьте работу приложения

- Откройте приложение в браузере
- Проверьте основные функции
- Убедитесь, что данные отображаются корректно

## Автоматический скрипт (рекомендуется)

Используйте готовый скрипт, который делает все шаги автоматически:

```bash
chmod +x scripts/apply-migration-safely.sh
./scripts/apply-migration-safely.sh
```

Скрипт автоматически:
1. ✅ Создаст резервную копию
2. ✅ Проверит статус миграций
3. ✅ Покажет, какие миграции будут применены
4. ✅ Запросит подтверждение
5. ✅ Применит миграции
6. ✅ Проверит результат

## Восстановление в случае ошибки

Если что-то пошло не так:

```bash
# 1. Остановите приложение
pm2 stop all

# 2. Восстановите из бэкапа
npx tsx scripts/restore-database.ts backups/backup_YYYY-MM-DDTHH-MM-SS.json

# 3. Проверьте данные
npx prisma studio

# 4. Запустите приложение
pm2 start all
```

## Проверка перед миграцией

Перед применением миграций убедитесь:

```bash
# 1. База данных существует и доступна
ls -lh prisma/dev.db

# 2. .env файл настроен правильно
cat .env | grep DATABASE_URL

# 3. Prisma Client сгенерирован
ls -la src/generated/prisma/client.ts

# 4. Все миграции на месте
ls -la prisma/migrations/ | wc -l
```

## Разница между командами

### `prisma migrate dev`
- **Использование:** Только для разработки
- **Что делает:** Создает новые миграции + применяет их
- **Безопасность:** Может изменить схему автоматически
- **Для продакшена:** ❌ НЕ ИСПОЛЬЗУЙТЕ

### `prisma migrate deploy`
- **Использование:** Для продакшена
- **Что делает:** Только применяет существующие миграции
- **Безопасность:** Безопасен, не изменяет схему
- **Для продакшена:** ✅ ИСПОЛЬЗУЙТЕ ЭТУ КОМАНДУ

### `prisma db push`
- **Использование:** Для быстрого прототипирования
- **Что делает:** Синхронизирует схему без миграций
- **Безопасность:** Может потерять данные при конфликтах
- **Для продакшена:** ❌ НЕ ИСПОЛЬЗУЙТЕ

## Полный чеклист для сервера

```bash
# ✅ 1. Создать бэкап
npx tsx scripts/backup-database.ts

# ✅ 2. Проверить статус
npx prisma migrate status

# ✅ 3. Остановить приложение
pm2 stop all

# ✅ 4. Применить миграции
npx prisma migrate deploy

# ✅ 5. Перегенерировать клиент
npx prisma generate

# ✅ 6. Запустить приложение
pm2 start all

# ✅ 7. Проверить работу
curl http://localhost:3000/api/auth/session
```

## Частые проблемы и решения

### Проблема: "Migration X is in a failed state"

**Решение:**
```bash
# Отметьте миграцию как примененную (если она действительно применена)
npx prisma migrate resolve --applied YYYYMMDDHHMMSS_migration_name

# Или откатите миграцию
npx prisma migrate resolve --rolled-back YYYYMMDDHHMMSS_migration_name
```

### Проблема: "Database schema is not in sync"

**Решение:**
```bash
# Проверьте разницу
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma

# Если нужно, создайте новую миграцию вручную
npx prisma migrate dev --create-only --name fix_schema
```

### Проблема: "Table already exists"

**Решение:**
```bash
# Проверьте, какие таблицы уже существуют
npx prisma db pull --print

# Если таблица уже существует, отметьте миграцию как примененную
npx prisma migrate resolve --applied YYYYMMDDHHMMSS_migration_name
```

## Рекомендации

1. **Всегда создавайте бэкап** перед миграциями
2. **Тестируйте миграции** на тестовом сервере сначала
3. **Применяйте миграции** в период низкой нагрузки
4. **Мониторьте логи** во время миграции
5. **Имейте план отката** на случай проблем
