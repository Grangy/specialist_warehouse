# 🚀 Инструкция по развертыванию на сервере

## Предварительные требования

- Node.js 18+ 
- npm или yarn
- Git
- PM2 (для управления процессом) - опционально

## Шаги развертывания

### 1. Подключение к серверу

```bash
ssh user@your-server-ip
```

### 2. Клонирование репозитория

```bash
# Перейдите в директорию для проектов (например, /var/www или /home/user/apps)
cd /var/www  # или другая директория

# Клонируйте репозиторий
git clone https://github.com/Grangy/specialist_warehouse.git
cd specialist_warehouse
```

### 3. Установка зависимостей

```bash
npm install
```

### 4. Настройка переменных окружения

```bash
# Создайте файл .env
cp .env.example .env

# Отредактируйте .env файл
nano .env
```

**Важно:** Укажите правильный путь к базе данных и настройки для production:

```env
# База данных
DATABASE_URL="file:./prisma/production.db"

# Для PWA в production (если используете HTTP)
NEXT_PUBLIC_DISABLE_SECURE_COOKIE=true

# Или для HTTPS
NEXT_PUBLIC_FORCE_SECURE_COOKIE=true

# Node environment
NODE_ENV=production
```

### 5. Применение миграций базы данных

```bash
# Применить все миграции
npx prisma migrate deploy

# Сгенерировать Prisma Client
npx prisma generate
```

### 6. Заполнение базы данных (опционально)

Если нужны тестовые данные:

```bash
npm run db:seed
```

### 7. Сборка проекта

```bash
npm run build
```

### 8. Запуск приложения

#### Вариант 1: Запуск через PM2 (рекомендуется)

```bash
# Установите PM2 глобально (если еще не установлен)
npm install -g pm2

# Запустите приложение через PM2
pm2 start npm --name "warehouse-app" -- start

# Сохраните конфигурацию PM2
pm2 save

# Настройте автозапуск при перезагрузке сервера
pm2 startup
```

**Управление через PM2:**
```bash
pm2 status              # Статус приложения
pm2 logs warehouse-app  # Просмотр логов
pm2 restart warehouse-app # Перезапуск
pm2 stop warehouse-app   # Остановка
pm2 delete warehouse-app # Удаление из PM2
```

#### Вариант 2: Запуск через systemd

Создайте файл `/etc/systemd/system/warehouse-app.service`:

```ini
[Unit]
Description=Warehouse Management System
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/specialist_warehouse
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Затем:

```bash
# Перезагрузите systemd
sudo systemctl daemon-reload

# Запустите сервис
sudo systemctl start warehouse-app

# Включите автозапуск
sudo systemctl enable warehouse-app

# Проверьте статус
sudo systemctl status warehouse-app

# Просмотр логов
sudo journalctl -u warehouse-app -f
```

#### Вариант 3: Прямой запуск (для тестирования)

```bash
npm start
```

Приложение будет доступно на `http://localhost:3000`

### 9. Настройка Nginx (рекомендуется для production)

Создайте конфигурационный файл `/etc/nginx/sites-available/warehouse`:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # Замените на ваш домен

    # Редирект на HTTPS (если используете SSL)
    # return 301 https://$server_name$request_uri;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Активируйте конфигурацию:

```bash
# Создайте символическую ссылку
sudo ln -s /etc/nginx/sites-available/warehouse /etc/nginx/sites-enabled/

# Проверьте конфигурацию
sudo nginx -t

# Перезагрузите Nginx
sudo systemctl reload nginx
```

### 10. Настройка SSL (опционально, но рекомендуется)

Используйте Let's Encrypt для бесплатного SSL сертификата:

```bash
# Установите certbot
sudo apt-get update
sudo apt-get install certbot python3-certbot-nginx

# Получите сертификат
sudo certbot --nginx -d your-domain.com

# Автоматическое обновление (настроено автоматически)
```

## Обновление приложения

### Быстрое обновление

```bash
# Перейдите в директорию проекта
cd /var/www/specialist_warehouse

# Получите последние изменения
git pull origin main

# Установите новые зависимости (если есть)
npm install

# Примените новые миграции (если есть)
npx prisma migrate deploy
npx prisma generate

# Пересоберите проект
npm run build

# Перезапустите приложение
pm2 restart warehouse-app
# или
sudo systemctl restart warehouse-app
```

### Полное обновление (если что-то пошло не так)

```bash
cd /var/www/specialist_warehouse

# Остановите приложение
pm2 stop warehouse-app
# или
sudo systemctl stop warehouse-app

# Создайте резервную копию базы данных
cp prisma/production.db prisma/production.db.backup

# Получите последние изменения
git fetch origin
git reset --hard origin/main

# Переустановите зависимости
rm -rf node_modules
npm install

# Примените миграции
npx prisma migrate deploy
npx prisma generate

# Пересоберите проект
npm run build

# Запустите приложение
pm2 start warehouse-app
# или
sudo systemctl start warehouse-app
```

## Резервное копирование базы данных

### Автоматическое резервное копирование

Создайте скрипт `/usr/local/bin/backup-warehouse-db.sh`:

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/warehouse"
DB_PATH="/var/www/specialist_warehouse/prisma/production.db"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR
cp $DB_PATH "$BACKUP_DIR/warehouse_$DATE.db"

# Удаляем резервные копии старше 30 дней
find $BACKUP_DIR -name "warehouse_*.db" -mtime +30 -delete

echo "Backup created: warehouse_$DATE.db"
```

Сделайте скрипт исполняемым:

```bash
chmod +x /usr/local/bin/backup-warehouse-db.sh
```

Добавьте в crontab (ежедневно в 2:00):

```bash
crontab -e

# Добавьте строку:
0 2 * * * /usr/local/bin/backup-warehouse-db.sh
```

## Мониторинг

### Просмотр логов

```bash
# PM2
pm2 logs warehouse-app

# systemd
sudo journalctl -u warehouse-app -f

# Nginx
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

### Мониторинг ресурсов

```bash
# Использование памяти и CPU
pm2 monit

# Или через htop
htop
```

## Устранение неполадок

### Приложение не запускается

1. Проверьте логи:
   ```bash
   pm2 logs warehouse-app
   # или
   sudo journalctl -u warehouse-app -n 50
   ```

2. Проверьте, что порт 3000 свободен:
   ```bash
   netstat -tulpn | grep 3000
   ```

3. Проверьте переменные окружения:
   ```bash
   cat .env
   ```

4. Проверьте права доступа к базе данных:
   ```bash
   ls -la prisma/production.db
   ```

### Ошибки миграций

```bash
# Проверьте статус миграций
npx prisma migrate status

# Если нужно, примените миграции вручную
npx prisma migrate deploy
```

### Проблемы с PWA

Убедитесь, что в `.env` правильно настроены переменные:
- Для HTTP: `NEXT_PUBLIC_DISABLE_SECURE_COOKIE=true`
- Для HTTPS: `NEXT_PUBLIC_FORCE_SECURE_COOKIE=true`

## Безопасность

1. **Не храните `.env` файл в Git** - он уже в `.gitignore`
2. **Используйте HTTPS** в production
3. **Ограничьте доступ к базе данных** - файл должен быть доступен только для пользователя приложения
4. **Регулярно обновляйте зависимости**:
   ```bash
   npm audit
   npm audit fix
   ```
5. **Настройте firewall**:
   ```bash
   sudo ufw allow 22/tcp    # SSH
   sudo ufw allow 80/tcp    # HTTP
   sudo ufw allow 443/tcp   # HTTPS
   sudo ufw enable
   ```

## Производительность

### Оптимизация для production

1. Убедитесь, что `NODE_ENV=production` установлен
2. Используйте PM2 с кластеризацией (для многоядерных серверов):
   ```bash
   pm2 start npm --name "warehouse-app" -i max -- start
   ```
3. Настройте кэширование в Nginx
4. Используйте CDN для статических файлов (опционально)

## Контакты и поддержка

При возникновении проблем проверьте:
- Логи приложения
- Логи Nginx
- Статус базы данных
- Переменные окружения

---

**Успешного развертывания! 🚀**

