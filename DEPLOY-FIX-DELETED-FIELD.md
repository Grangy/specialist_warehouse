# Исправление ошибки компиляции на сервере

## Проблема
Ошибка компиляции: `'deleted' does not exist in type 'ShipmentWhereInput'`

Это происходит потому, что на сервере не применена миграция и не сгенерирован Prisma Client после добавления поля `deleted`.

## Решение

Выполните следующие команды на сервере:

```bash
cd /opt/specialist_warehouse

# 1. Применить миграцию к базе данных
npx prisma migrate deploy

# 2. Сгенерировать Prisma Client с новыми типами
npx prisma generate

# 3. Пересобрать проект
npm run build

# 4. Перезапустить приложение
pm2 restart sklad-spec
# или
systemctl restart specialist-warehouse
```

## Проверка

После выполнения команд проверьте, что:
1. Миграция применена: `npx prisma migrate status`
2. Проект собирается: `npm run build`
3. Приложение работает: проверьте логи `pm2 logs sklad-spec`

## Альтернативный вариант (если миграция не применяется)

Если миграция не применяется, можно выполнить SQL напрямую:

```bash
cd /opt/specialist_warehouse

# Подключитесь к базе данных и выполните:
sqlite3 prisma/dev.db <<EOF
ALTER TABLE shipments ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shipments ADD COLUMN deleted_at TEXT;
EOF

# Затем сгенерируйте Prisma Client
npx prisma generate

# Пересоберите проект
npm run build

# Перезапустите приложение
pm2 restart sklad-spec
```

## Миграция SQL

Если нужно выполнить миграцию вручную, вот SQL:

```sql
-- CreateTable
ALTER TABLE "shipments" ADD COLUMN "deleted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "shipments" ADD COLUMN "deleted_at" TEXT;
```

