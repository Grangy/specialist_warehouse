# 🚀 Деплой: Добавление поля `art` (дополнительный артикул)

## ⚡ Быстрое обновление (копировать все команды)

```bash
# 1. Подключитесь к серверу и перейдите в директорию проекта
cd /path/to/sklad_spec  # или /var/www/specialist_warehouse

# 2. Создайте бэкап БД (РЕКОМЕНДУЕТСЯ)
mkdir -p backups
cp prisma/dev.db backups/dev.db.backup.$(date +%Y%m%d_%H%M%S) 2>/dev/null || echo "⚠️  БД не найдена"

# 3. Остановите приложение (если используется PM2)
pm2 stop sklad-spec 2>/dev/null || pm2 stop warehouse-app 2>/dev/null || echo "⚠️  PM2 не запущен"

# 4. Обновите код из Git
git fetch origin
git checkout main
git pull origin main

# 5. Установите зависимости (если были добавлены новые)
npm install

# 6. Примените миграции базы данных (ВАЖНО!)
npx prisma migrate deploy

# 7. Регенерируйте Prisma Client
npx prisma generate

# 8. Соберите проект
npm run build

# 9. Перезапустите приложение
pm2 restart sklad-spec 2>/dev/null || pm2 restart warehouse-app 2>/dev/null || pm2 start npm --name "sklad-spec" -- start

# 10. Проверьте статус
pm2 status
pm2 logs sklad-spec --lines 50 --nostream 2>/dev/null || pm2 logs warehouse-app --lines 50 --nostream
```

---

## 📋 Что изменилось

### База данных
- ✅ Добавлено поле `art` (TEXT, nullable) в таблицу `shipment_lines`
- ✅ Миграция: `20251225101019_add_art_field_to_shipment_line`

### Код
- ✅ Обновлены API endpoints для сохранения и возврата `art`
- ✅ Обновлены компоненты для отображения `art || sku` вместо `sku`
- ✅ Связи остаются как раньше (используется `sku` для запросов)

---

## ✅ Проверка после деплоя

1. **Проверьте, что миграция применена:**
```bash
npx prisma migrate status
```

2. **Проверьте логи приложения:**
```bash
pm2 logs sklad-spec --lines 100
```

3. **Проверьте работу API:**
```bash
curl http://localhost:3000/api/auth/session
```

4. **Проверьте базу данных (опционально):**
```bash
npx prisma studio
# Откройте браузер и проверьте, что поле `art` появилось в таблице `shipment_lines`
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

## 📝 Важные замечания

1. **Миграция безопасна** - добавляет только новое поле с NULL значениями, существующие данные не затрагиваются
2. **Бэкап рекомендуется** - на всякий случай создайте резервную копию БД перед применением миграции
3. **Время простоя минимально** - приложение будет остановлено только на время обновления (обычно 1-2 минуты)
4. **Обратная совместимость** - если `art` не передан от 1С, будет показываться `sku` (fallback)

---

## 🆘 Поддержка

Если возникли проблемы:
1. Проверьте логи: `pm2 logs sklad-spec`
2. Проверьте статус БД: `npx prisma migrate status`
3. Проверьте, что все миграции применены: `ls prisma/migrations/`


