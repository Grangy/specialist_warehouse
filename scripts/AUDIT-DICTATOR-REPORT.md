# Отчет об аудите начисления баллов диктовщикам

## Проблема

Диктовщик не получает баллы (или получает неправильно), хотя должен получать 0.75 от баллов проверяльщика.

## Анализ кода

### Текущая логика (src/lib/ranking/updateStats.ts)

1. **Создание TaskStatistics для диктовщика** (строки 382-449):
   - ✅ Создается TaskStatistics с `roleType: 'checker'`
   - ✅ `orderPoints` устанавливается в `dictatorPoints = checkerPoints * 0.75`
   - ✅ Все остальные поля копируются из статистики проверяльщика

2. **Обновление дневной статистики** (строка 453):
   - ✅ Вызывается `updateDailyStats(task.dictatorId, task.confirmedAt, dictatorStats)`
   - ⚠️ **ПРОБЛЕМА**: Функция `updateDailyStats` пересчитывает ВСЕ статистики за день из базы данных
   - ⚠️ **ПРОБЛЕМА**: Если TaskStatistics создается асинхронно, она может быть еще не доступна для запроса

3. **Обновление месячной статистики** (строка 456):
   - ✅ Вызывается `updateMonthlyStats(task.dictatorId, task.confirmedAt, dictatorStats)`
   - ✅ Месячная статистика рассчитывается на основе дневных статистик

### Потенциальные проблемы

1. **Порядок операций**:
   - TaskStatistics создается через `upsert`
   - Сразу после этого вызывается `updateDailyStats`
   - Если есть задержка в записи в БД, новая TaskStatistics может быть не найдена

2. **Фильтрация в updateDailyStats** (строки 492-503):
   - Запрос ищет TaskStatistics с `roleType: 'checker'` и `task.confirmedAt` в этот день
   - Это должно работать для диктовщика, так как у него тоже `roleType: 'checker'`
   - НО: если TaskStatistics еще не записана в БД, она не будет найдена

3. **Обновление рангов** (строка 564):
   - `updateDailyRanks()` обновляет ранги для ВСЕХ пользователей
   - Это может быть проблемой производительности, но не должно влиять на правильность

## Решение

### Вариант 1: Явное ожидание записи (рекомендуется)

Убедиться, что TaskStatistics записана в БД перед обновлением дневной статистики:

```typescript
// Создаем TaskStatistics для диктовщика
await prisma.taskStatistics.upsert({...});

// Явно проверяем, что запись создана
const createdStats = await prisma.taskStatistics.findUnique({
  where: {
    taskId_userId_roleType: {
      taskId: task.id,
      userId: task.dictatorId,
      roleType: 'checker',
    },
  },
});

if (!createdStats) {
  console.error(`[updateCheckerStats] Не удалось создать TaskStatistics для диктовщика ${task.dictatorId}`);
  return;
}

// Теперь обновляем дневную статистику
await updateDailyStats(task.dictatorId, task.confirmedAt, dictatorStats);
```

### Вариант 2: Использовать транзакцию

Обернуть все операции в транзакцию, чтобы гарантировать атомарность:

```typescript
await prisma.$transaction(async (tx) => {
  // Создаем TaskStatistics
  await tx.taskStatistics.upsert({...});
  
  // Обновляем дневную статистику (она будет видеть новую запись)
  await updateDailyStatsInTransaction(tx, task.dictatorId, task.confirmedAt);
});
```

### Вариант 3: Пересчитать статистику позже

Если проблема в порядке операций, можно пересчитать статистику диктовщика отдельно:

```typescript
// Создаем TaskStatistics
await prisma.taskStatistics.upsert({...});

// Обновляем дневную статистику с небольшой задержкой
setTimeout(async () => {
  await updateDailyStats(task.dictatorId, task.confirmedAt, dictatorStats);
}, 100);
```

## Как проверить

Запустите скрипт аудита:

```bash
npm run audit:dictator
```

Скрипт проверит:
- ✅ Создаются ли TaskStatistics для диктовщиков
- ✅ Правильно ли рассчитываются баллы (0.75 от баллов проверяльщика)
- ✅ Обновляются ли дневные статистики
- ✅ Обновляются ли месячные статистики
- ✅ Правильно ли обновляются ранги

## Рекомендации

1. **Немедленно**: Запустить скрипт аудита для выявления проблем
2. **Краткосрочно**: Добавить явную проверку создания TaskStatistics перед обновлением дневной статистики
3. **Долгосрочно**: Рассмотреть использование транзакций для гарантии атомарности операций
