# Инструкция по откату на сервере

## Откат до коммита a70efd7

### Вариант 1: Через git pull (если уже был force push)

```bash
# 1. Подключитесь к серверу
ssh root@77.222.47.184

# 2. Перейдите в директорию проекта
cd /opt/specialist_warehouse

# 3. Получите последние изменения (force pull)
git fetch origin
git reset --hard origin/main

# 4. Пересоберите проект
npm run build

# 5. Перезапустите приложение
pm2 restart warehouse
```

### Вариант 2: Прямой откат на сервере

```bash
# 1. Подключитесь к серверу
ssh root@77.222.47.184

# 2. Перейдите в директорию проекта
cd /opt/specialist_warehouse

# 3. Остановите приложение (опционально, но рекомендуется)
pm2 stop warehouse

# 4. Откатите до нужного коммита
git reset --hard a70efd7

# 5. Пересоберите проект
npm run build

# 6. Перезапустите приложение
pm2 restart warehouse
```

### Вариант 3: Через git checkout (безопасный способ)

```bash
# 1. Подключитесь к серверу
ssh root@77.222.47.184

# 2. Перейдите в директорию проекта
cd /opt/specialist_warehouse

# 3. Остановите приложение
pm2 stop warehouse

# 4. Переключитесь на нужный коммит
git checkout a70efd7

# 5. Пересоберите проект
npm run build

# 6. Перезапустите приложение
pm2 restart warehouse
```

## Проверка после отката

```bash
# Проверьте текущий коммит
git log --oneline -5

# Проверьте статус приложения
pm2 status

# Проверьте логи
pm2 logs warehouse --lines 50
```

## Важные замечания

⚠️ **Внимание**: 
- `git reset --hard` удалит все локальные изменения на сервере
- Рекомендуется сделать backup перед откатом
- Если есть незакоммиченные изменения, они будут потеряны

## Создание backup перед откатом (рекомендуется)

```bash
# Создайте backup директории
cp -r /opt/specialist_warehouse /opt/specialist_warehouse_backup_$(date +%Y%m%d_%H%M%S)

# Или создайте backup только базы данных
cp /opt/specialist_warehouse/prisma/dev.db /opt/specialist_warehouse/prisma/dev.db.backup_$(date +%Y%m%d_%H%M%S)
```

