# Исправление ошибки базы данных

## Проблема
```
The column `main.shipment_tasks.checker_name` does not exist in the current database.
```

## Решение

### 1. Проверьте миграции
```bash
npx prisma migrate status
```

### 2. Примените миграции (если есть не примененные)
```bash
npx prisma migrate deploy
```

### 3. Перегенерируйте Prisma Client
```bash
npx prisma generate
```

### 4. Перезапустите dev сервер
Остановите текущий процесс (Ctrl+C) и запустите заново:
```bash
npm run dev
```

## Проверка

Проверьте, что колонки существуют:
```bash
sqlite3 prisma/dev.db "PRAGMA table_info(shipment_tasks);" | grep checker
```

Должны быть видны:
- checker_name
- checker_id  
- confirmed_at

## Если проблема сохраняется

1. Убедитесь, что используете правильную базу данных (проверьте `.env` файл)
2. Проверьте, что миграция `20251207171129_add_checker_tracking` применена
3. Удалите `.next` папку и пересоберите:
   ```bash
   rm -rf .next
   npm run build
   ```

