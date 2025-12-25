# 🔧 Исправление ошибки компиляции heartbeat

## Проблема
```
Type error: Object literal may only specify known properties, and 'lastHeartbeat' does not exist in type 'ShipmentTaskLockUpdateInput'
```

## Причина
Prisma Client не был перегенерирован после добавления поля `lastHeartbeat` в схему.

## Решение

На сервере выполните следующие команды:

```bash
# 1. Перейти в директорию проекта
cd /opt/specialist_warehouse

# 2. Применить миграцию (если еще не применена)
npx prisma migrate deploy

# 3. Перегенерировать Prisma Client
npx prisma generate

# 4. Пересобрать проект
npm run build
```

## Альтернативный вариант (если миграция уже применена)

Если миграция уже применена, достаточно перегенерировать Prisma Client:

```bash
cd /opt/specialist_warehouse
npx prisma generate
npm run build
```

## Проверка

После выполнения команд проверьте, что сборка проходит успешно:

```bash
npm run build
```

Должно быть:
```
✓ Compiled successfully
```

