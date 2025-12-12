# 🚀 Инструкция по деплою новой версии

## ⚠️ ВАЖНО: Безопасное обновление базы данных

Миграции добавляют только новые поля с дефолтными значениями, поэтому **данные не будут потеряны**. Но рекомендуется сделать бэкап на всякий случай.

---

## 📋 Пошаговая инструкция

### 1. Подключитесь к серверу
```bash
ssh user@your-server
cd /path/to/sklad_spec
```

### 2. Создайте бэкап базы данных (РЕКОМЕНДУЕТСЯ)
```bash
# Создаем директорию для бэкапов (если её нет)
mkdir -p backups

# Делаем бэкап БД с датой и временем
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S)
```

### 3. Остановите приложение (если используется PM2)
```bash
pm2 stop sklad-spec
# или
pm2 stop all
```

### 4. Обновите код из Git
```bash
# Получаем последние изменения
git fetch origin

# Переключаемся на main ветку
git checkout main

# Обновляем код
git pull origin main
```

### 5. Установите зависимости (если были добавлены новые)
```bash
npm install
```

### 6. Примените миграции базы данных
```bash
# Применяем миграции (безопасно, только добавляет новые поля)
npx prisma migrate deploy
```

**Что делает эта команда:**
- Добавляет поля `confirmed_qty` и `confirmed` в таблицы `shipment_lines` и `shipment_task_lines`
- Устанавливает дефолтные значения (NULL для `confirmed_qty`, false для `confirmed`)
- **НЕ удаляет существующие данные**

### 7. Регенерируйте Prisma Client
```bash
npx prisma generate
```

### 8. Соберите проект
```bash
npm run build
```

### 9. Перезапустите приложение

**Если используете PM2:**
```bash
pm2 restart sklad-spec
# или
pm2 start npm --name "sklad-spec" -- start
```

**Если используете systemd:**
```bash
sudo systemctl restart sklad-spec
```

**Если запускаете напрямую:**
```bash
npm start
```

---

## 🔄 Полная последовательность команд (копировать все сразу)

```bash
# 1. Подключение к серверу
ssh user@your-server
cd /path/to/sklad_spec

# 2. Бэкап БД
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S)

# 3. Остановка приложения
pm2 stop sklad-spec

# 4. Обновление кода
git fetch origin
git checkout main
git pull origin main

# 5. Установка зависимостей
npm install

# 6. Применение миграций
npx prisma migrate deploy

# 7. Регенерация Prisma Client
npx prisma generate

# 8. Сборка проекта
npm run build

# 9. Перезапуск приложения
pm2 restart sklad-spec

# 10. Проверка статуса
pm2 status
pm2 logs sklad-spec --lines 50
```

## 🚀 Быстрый деплой через скрипт

Если у вас есть скрипт `deploy.sh`, просто выполните:

```bash
chmod +x deploy.sh
./deploy.sh
```

Скрипт автоматически выполнит все шаги выше.

---

## ✅ Проверка после деплоя

1. **Проверьте логи:**
```bash
pm2 logs sklad-spec --lines 100
```

2. **Проверьте статус приложения:**
```bash
pm2 status
```

3. **Проверьте работу API:**
```bash
curl http://localhost:3000/api/auth/session
```

4. **Проверьте базу данных:**
```bash
npx prisma studio
# Откройте браузер и проверьте, что новые поля появились
```

---

## 🔧 Если что-то пошло не так

### Откат миграции (если нужно)
```bash
# Восстановите бэкап БД
cp backups/dev.db.backup.YYYYMMDD_HHMMSS prisma/dev.db

# Откатите код
git checkout HEAD~1
npm install
npx prisma generate
npm run build
pm2 restart sklad-spec
```

### Проверка миграций
```bash
# Посмотреть статус миграций
npx prisma migrate status

# Посмотреть список миграций
ls -la prisma/migrations/
```

---

## 📝 Последние изменения

- ✅ Добавлен API endpoint `/api/shipments/sync-1c` для синхронизации с 1С
- ✅ Добавлены поля `exportedTo1C`, `exportedTo1CAt`, `places` в БД
- ✅ Добавлен режим "Ожидание" с отдельной карточкой
- ✅ Исправлена логика отображения статусов заданий
- ✅ Добавлены поля `confirmed_qty` и `confirmed` в БД
- ✅ Добавлен API endpoint `/api/shipments/[id]/save-confirmation-progress`
- ✅ Восстановлены оригинальные кнопки в карточках заказов

---

## 🆘 Поддержка

Если возникли проблемы:
1. Проверьте логи: `pm2 logs sklad-spec`
2. Проверьте статус БД: `npx prisma migrate status`
3. Проверьте, что все миграции применены: `ls prisma/migrations/`

