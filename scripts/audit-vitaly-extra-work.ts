#!/usr/bin/env npx tsx
/**
 * Полный аудит работы пользователя за последние 5 рабочих дней.
 * Объясняет показатель «Произв.» (productivity) в разделе «Дополнительная работа».
 *
 * Использование:
 *   npx tsx scripts/audit-vitaly-extra-work.ts [имя]
 *   npx tsx scripts/audit-vitaly-extra-work.ts Виталий
 *
 * Результат: audit-reports/AUDIT-VITALY-EXTRA-WORK.md
 */

import { PrismaClient } from '../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import { getLast5WorkingDaysMoscow, getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { getExtraWorkRatePerHour } from '../src/lib/ranking/extraWorkPoints';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

async function main() {
  const nameFilter = process.argv[2] || 'Виталий';
  const projectRoot = process.cwd();
  const reportPath = path.join(projectRoot, 'audit-reports', 'AUDIT-VITALY-EXTRA-WORK.md');

  const allWorkers = await prisma.user.findMany({
    where: { role: { in: ['collector', 'checker', 'admin'] } },
    select: { id: true, name: true },
  });

  const user = allWorkers.find((u) => u.name.toLowerCase().includes(nameFilter.toLowerCase()));
  if (!user) {
    console.error(`Пользователь не найден по фильтру "${nameFilter}". Доступные: ${allWorkers.map((u) => u.name).join(', ')}`);
    process.exit(1);
  }

  const now = new Date();
  const last5Days = getLast5WorkingDaysMoscow(now);
  const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');

  // Баллы по каждому дню
  const dayDetails: Array<{
    date: string;
    dayName: string;
    collectorPts: number;
    checkerPts: number;
    dictatorPts: number;
    totalPts: number;
  }> = [];

  let totalPoints5Days = 0;

  for (let i = 0; i < last5Days.length; i++) {
    const day = last5Days[i];
    const [collectorPts, checkerPts, dictatorPts] = await Promise.all([
      prisma.taskStatistics.aggregate({
        where: {
          userId: user.id,
          roleType: 'collector',
          task: {
            OR: [
              { completedAt: { gte: day.start, lte: day.end } },
              { confirmedAt: { gte: day.start, lte: day.end } },
            ],
          },
        },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: {
          userId: user.id,
          roleType: 'checker',
          task: { confirmedAt: { gte: day.start, lte: day.end } },
        },
        _sum: { orderPoints: true },
      }),
      prisma.taskStatistics.aggregate({
        where: {
          userId: user.id,
          roleType: 'dictator',
          task: { confirmedAt: { gte: day.start, lte: day.end } },
        },
        _sum: { orderPoints: true },
      }),
    ]);

    const collector = collectorPts._sum.orderPoints ?? 0;
    const checker = checkerPts._sum.orderPoints ?? 0;
    const dictator = dictatorPts._sum.orderPoints ?? 0;
    const total = collector + checker + dictator;
    totalPoints5Days += total;

    const dateStr = day.start.toISOString().slice(0, 10);
    const dayName = day.start.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });

    dayDetails.push({
      date: dateStr,
      dayName,
      collectorPts: collector,
      checkerPts: checker,
      dictatorPts: dictator,
      totalPts: total,
    });
  }

  const productivity = (totalPoints5Days / 40) * 0.9;
  const productivityRounded = Math.round(productivity * 100) / 100;

  const rateFromLib = await getExtraWorkRatePerHour(prisma, user.id, now);

  // Сессии доп. работы за неделю
  const extraSessions = await prisma.extraWorkSession.findMany({
    where: {
      userId: user.id,
      status: 'stopped',
      stoppedAt: { gte: weekStart, lte: weekEnd },
    },
    select: {
      id: true,
      warehouse: true,
      comment: true,
      startedAt: true,
      stoppedAt: true,
      elapsedSecBeforeLunch: true,
    },
    orderBy: { stoppedAt: 'asc' },
  });

  const extraHoursTotal = extraSessions.reduce((s, sess) => s + (sess.elapsedSecBeforeLunch || 0) / 3600, 0);

  // Формируем отчёт
  const md = `# Аудит работы: ${user.name}

**Дата аудита:** ${now.toLocaleString('ru-RU')}

## Показатель «Произв.» (productivity) = ${productivityRounded}

### Формула

\`\`\`
Произв. = (сумма баллов за 5 рабочих дней / 40) × 0.9
\`\`\`

- **40** — стандартная рабочая неделя (часов)
- **0.9** — коэффициент для доп. работы

### Расчёт по дням

| День | Дата | Сборщик | Проверяющий | Диктовщик | Итого |
|------|------|---------|-------------|-----------|-------|
${dayDetails.map((d) => `| ${d.dayName} | ${d.date} | ${d.collectorPts.toFixed(1)} | ${d.checkerPts.toFixed(1)} | ${d.dictatorPts.toFixed(1)} | **${d.totalPts.toFixed(1)}** |`).join('\n')}
| | | | | **Сумма** | **${totalPoints5Days.toFixed(1)}** |

### Проверка

- Сумма баллов за 5 раб. дней: **${totalPoints5Days.toFixed(1)}**
- (${totalPoints5Days.toFixed(1)} / 40) × 0.9 = **${productivityRounded}** баллов/час
- getExtraWorkRatePerHour: **${rateFromLib.toFixed(2)}** (должно совпадать)

## Дополнительная работа (завершённые сессии за неделю)

Период: ${weekStart.toISOString().slice(0, 10)} — ${weekEnd.toISOString().slice(0, 10)}

${extraSessions.length === 0 ? 'Нет завершённых сессий.' : `
| Склад | Задание | Начало | Окончание | Часы до обеда |
|-------|---------|--------|-----------|----------------|
${extraSessions.map((s) => `| ${s.warehouse ?? '—'} | ${(s.comment ?? '').slice(0, 30)} | ${s.startedAt?.toISOString().slice(0, 16) ?? '—'} | ${s.stoppedAt?.toISOString().slice(0, 16) ?? '—'} | ${((s.elapsedSecBeforeLunch ?? 0) / 3600).toFixed(2)} |`).join('\n')}

**Всего часов доп. работы за неделю:** ${extraHoursTotal.toFixed(2)} ч
`}

## Выводы

${productivityRounded >= 25 ? `Показатель **${productivityRounded}** сформирован высокими баллами за последние 5 рабочих дней (${totalPoints5Days.toFixed(0)} баллов). Это означает активную работу пользователя в ролях сборщика, проверяющего и/или диктовщика.` : `Показатель **${productivityRounded}** отражает среднюю производительность за последние 5 рабочих дней.`}

---

*Сгенерировано: \`npx tsx scripts/audit-vitaly-extra-work.ts ${nameFilter}\`*
`;

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, md, 'utf-8');

  console.log(`\n✓ Аудит записан в ${reportPath}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
