# Пересчёт очков за сегодня на сервере

На сервере (после SSH в каталог проекта) выполните по порядку.

## 1. Пересчёт баллов по новой формуле скорости (±10%)

Обновляет в БД только записи `TaskStatistics` за **сегодня** (efficiencyClamped 0.9..1.1 и orderPoints):

```bash
npm run recalc:today-top
```

## 2. Пересчёт дневной/месячной сводки

Пересчитывает `DailyStats` и `MonthlyStats` за сегодня по уже обновлённым `TaskStatistics`:

```bash
npm run stats:recalculate-today
```

## Одной командой

```bash
npm run recalc:today-top && npm run stats:recalculate-today
```

## Требования

- В каталоге проекта есть `.env` с `DATABASE_URL`.
- Установлены зависимости (`npm install`), выполнен `npx prisma generate` (обычно уже есть после деплоя).
- Для запуска скриптов нужен `tsx` (есть в `devDependencies`); на сервере после `npm install` команды `npm run ...` подхватят его из `node_modules/.bin`.
