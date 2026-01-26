# Исправление ошибки сборки на сервере

## Проблема
```
Type error: 'dictatorId' does not exist in type 'ShipmentTaskUpdateInput'
```

## Причина
Prisma Client не был перегенерирован после добавления поля `dictatorId` в схему.

## Решение

Выполните на сервере следующие команды:

```bash
cd /opt/specialist_warehouse

# 1. Получите последние изменения
git pull origin main

# 2. Перегенерируйте Prisma Client (ОБЯЗАТЕЛЬНО!)
npx prisma generate

# 3. Соберите проект
npm run build
```

## Или используйте скрипт деплоя

```bash
cd /opt/specialist_warehouse
./deploy.sh
```

Скрипт `deploy.sh` автоматически:
1. Создаст бэкап БД
2. Остановит приложение
3. Обновит код из Git
4. Установит зависимости
5. Применит миграции
6. **Перегенерирует Prisma Client** ← это важно!
7. Соберет проект
8. Перезапустит приложение

## Важно

После любых изменений в `prisma/schema.prisma` всегда нужно:
1. Применить миграции: `npx prisma migrate deploy`
2. Перегенерировать клиент: `npx prisma generate`
3. Только потом собирать: `npm run build`
