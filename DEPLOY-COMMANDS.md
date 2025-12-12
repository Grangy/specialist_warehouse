# 🚀 Команды для деплоя на сервере

## 📋 Полный список команд (скопировать и выполнить на сервере)

```bash
# ============================================
# 1. ПОДКЛЮЧЕНИЕ К СЕРВЕРУ
# ============================================
ssh root@your-server-ip
# или
ssh user@your-server-ip

# Переход в директорию проекта
cd /opt/specialist_warehouse
# или
cd /path/to/sklad_spec

# ============================================
# 2. СОЗДАНИЕ БЭКАПА БАЗЫ ДАННЫХ
# ============================================
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Бэкап создан"

# ============================================
# 3. ОСТАНОВКА ПРИЛОЖЕНИЯ
# ============================================
pm2 stop sklad-spec
# или если приложение называется по-другому:
# pm2 stop all

# ============================================
# 4. ОБНОВЛЕНИЕ КОДА ИЗ GIT
# ============================================
git fetch origin
git checkout main
git pull origin main

# ============================================
# 5. УСТАНОВКА ЗАВИСИМОСТЕЙ
# ============================================
npm install

# ============================================
# 6. ПРИМЕНЕНИЕ МИГРАЦИЙ БАЗЫ ДАННЫХ
# ============================================
npx prisma migrate deploy

# ============================================
# 7. РЕГЕНЕРАЦИЯ PRISMA CLIENT
# ============================================
npx prisma generate

# ============================================
# 8. СБОРКА ПРОЕКТА
# ============================================
npm run build

# ============================================
# 9. ПЕРЕЗАПУСК ПРИЛОЖЕНИЯ
# ============================================
pm2 restart sklad-spec
# или если приложение не запущено:
# pm2 start npm --name "sklad-spec" -- start

# ============================================
# 10. ПРОВЕРКА СТАТУСА
# ============================================
pm2 status
pm2 logs sklad-spec --lines 50
```

---

## 🎯 Одной командой (если используете скрипт)

```bash
cd /opt/specialist_warehouse && \
mkdir -p backups && \
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) && \
pm2 stop sklad-spec && \
git fetch origin && \
git checkout main && \
git pull origin main && \
npm install && \
npx prisma migrate deploy && \
npx prisma generate && \
npm run build && \
pm2 restart sklad-spec && \
pm2 status && \
pm2 logs sklad-spec --lines 20
```

---

## 🔍 Проверка после деплоя

```bash
# Проверка статуса PM2
pm2 status

# Просмотр логов
pm2 logs sklad-spec --lines 100

# Проверка работы API
curl http://localhost:3000/api/auth/session

# Проверка статуса миграций
npx prisma migrate status

# Открыть Prisma Studio для проверки БД
npx prisma studio
```

---

## 🛠 Альтернативные варианты запуска

### Если используете systemd вместо PM2:

```bash
# Остановка
sudo systemctl stop sklad-spec

# После деплоя - запуск
sudo systemctl start sklad-spec

# Проверка статуса
sudo systemctl status sklad-spec
```

### Если запускаете напрямую через npm:

```bash
# Остановка (Ctrl+C в терминале где запущено)

# После деплоя - запуск
npm start
```

---

## ⚠️ Если что-то пошло не так

### Откат к предыдущей версии:

```bash
# 1. Восстановить бэкап БД
cp backups/dev.db.backup.YYYYMMDD_HHMMSS prisma/dev.db

# 2. Откатить код
git checkout HEAD~1

# 3. Переустановить зависимости и пересобрать
npm install
npx prisma generate
npm run build

# 4. Перезапустить
pm2 restart sklad-spec
```

### Проверка миграций:

```bash
# Статус миграций
npx prisma migrate status

# Список всех миграций
ls -la prisma/migrations/
```

---

## 📝 Примечания

- **Бэкап БД** - всегда делайте перед деплоем!
- **Миграции** - применяются автоматически, данные не теряются
- **PM2** - рекомендуется для production
- **Порт** - по умолчанию 3000, можно изменить через переменную окружения `PORT`

---

## 🔗 Полезные команды PM2

```bash
# Список всех процессов
pm2 list

# Просмотр логов в реальном времени
pm2 logs sklad-spec

# Перезапуск
pm2 restart sklad-spec

# Остановка
pm2 stop sklad-spec

# Удаление из PM2
pm2 delete sklad-spec

# Сохранение конфигурации PM2
pm2 save

# Автозапуск при перезагрузке сервера
pm2 startup
```

