# База артикулов по названию (JSON)

## Как загрузить в Git

Локально, после обновления базы (`npm run export:art`):

```bash
git add scripts/art-by-name-base.json
git commit -m "Обновлена база артикулов по названию"
git push origin main
```

Если коммитите вместе с другими файлами:

```bash
git add scripts/art-by-name-base.json scripts/export-art-by-name.ts scripts/apply-art-from-base.ts scripts/art-base-utils.ts docs/DB-RESTORE-AND-ART.md package.json
git commit -m "База артикулов по названию: экспорт/применение"
git push origin main
```

## Как выгрузить на сервер и применить

**1. Подтянуть код и базу на сервере:**

```bash
cd /var/www/specialist_warehouse   # или ваш путь к проекту
git pull origin main
```

Файл `scripts/art-by-name-base.json` окажется в репозитории.

**2. Применить базу к заказам (сначала просмотр, потом запись):**

```bash
# Только показать, что будет обновлено
npm run apply:art

# Записать артикулы в БД
npx tsx scripts/apply-art-from-base.ts --apply
```

**3. Проверить результат:**

```bash
npm run audit:art
```

## Обновление базы

Когда на локальной БД появились новые артикулы:

1. Локально: `npm run export:art` — перезапишет `scripts/art-by-name-base.json`
2. Закоммитить и запушить файл (см. выше)
3. На сервере: `git pull`, затем снова `npm run apply:art` (просмотр) и при необходимости `--apply`
