# ⚡ Быстрое развертывание на сервере

## Команды для копирования и вставки

### 1. Первоначальная установка

```bash
# Клонирование
cd /var/www
git clone https://github.com/Grangy/specialist_warehouse.git
cd specialist_warehouse

# Установка зависимостей
npm install

# Настройка окружения
cp .env.example .env
nano .env  # Отредактируйте DATABASE_URL и другие настройки

# Миграции БД
npx prisma migrate deploy
npx prisma generate

# Сборка
npm run build

# Запуск через PM2
npm install -g pm2
pm2 start npm --name "warehouse-app" -- start
pm2 save
pm2 startup
```

### 2. Обновление приложения

```bash
cd /var/www/specialist_warehouse
git pull origin main
npm install
npx prisma migrate deploy
npx prisma generate
npm run build
pm2 restart warehouse-app
```

### 3. Полезные команды

```bash
# Статус приложения
pm2 status

# Логи
pm2 logs warehouse-app

# Перезапуск
pm2 restart warehouse-app

# Остановка
pm2 stop warehouse-app

# Резервная копия БД
cp prisma/production.db prisma/production.db.backup
```

### 4. Настройка Nginx (один раз)

```bash
sudo nano /etc/nginx/sites-available/warehouse
```

Вставьте:
```nginx
server {
    listen 80;
    server_name your-domain.com;
    
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

Активируйте:
```bash
sudo ln -s /etc/nginx/sites-available/warehouse /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

**Подробная инструкция:** см. [DEPLOYMENT.md](./DEPLOYMENT.md)

