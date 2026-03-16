/**
 * Аудит: почему мало баллов за доп. работу.
 * Показывает ставку, коэффициент дня, формулу.
 *
 * Запуск: npx tsx scripts/audit-extra-work-rate.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getExtraWorkRatePerHour } from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate, getWeekdayWorkloadCoefficients } from '../src/lib/ranking/weekdayCoefficients';
import { getLast5WorkingDaysMoscow } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== АУДИТ: почему мало баллов за доп. работу ===\n');

  const now = new Date();
  const activeSessions = await prisma.extraWorkSession.findMany({
    where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
    include: { user: { select: { id: true, name: true } } },
  });

  const coeffs = await getWeekdayWorkloadCoefficients(prisma);
  const dowNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const mskDow = new Date(now.getTime() + 3 * 60 * 60 * 1000).getUTCDay();
  const todayCoef = await getWeekdayCoefficientForDate(prisma, now);

  console.log('--- Коэффициенты по дням (прошлая неделя) ---');
  for (let d = 1; d <= 5; d++) {
    console.log(`  ${dowNames[d]}: ${coeffs[d]?.toFixed(3) ?? 1}`);
  }
  console.log(`  Сегодня (${dowNames[mskDow]}): коэф. = ${todayCoef.toFixed(3)}`);
  console.log('');

  const days = getLast5WorkingDaysMoscow(now);
  console.log('--- Последние 5 рабочих дней (для ставки) ---');
  for (const d of days) {
    console.log(`  ${d.start.toISOString().slice(0, 10)} — ${d.end.toISOString().slice(0, 10)}`);
  }
  console.log('');

  console.log('--- Ставка и баллы за 1 час (по пользователям с активной сессией) ---');
  for (const sess of activeSessions) {
    const rate = await getExtraWorkRatePerHour(prisma, sess.userId, now);
    const ptsPerHour = rate * todayCoef;
    const ptsPer10Min = (10 / 60) * ptsPerHour;

    // Сумма баллов за 5 дней
    let total5Days = 0;
    for (const day of days) {
      const [c, ch, d] = await Promise.all([
        prisma.taskStatistics.aggregate({
          where: { userId: sess.userId, roleType: 'collector', task: { OR: [{ completedAt: { gte: day.start, lte: day.end } }, { confirmedAt: { gte: day.start, lte: day.end } }] } },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: { userId: sess.userId, roleType: 'checker', task: { confirmedAt: { gte: day.start, lte: day.end } } },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: { userId: sess.userId, roleType: 'dictator', task: { confirmedAt: { gte: day.start, lte: day.end } } },
          _sum: { orderPoints: true },
        }),
      ]);
      total5Days += (c._sum.orderPoints ?? 0) + (ch._sum.orderPoints ?? 0) + (d._sum.orderPoints ?? 0);
    }

    console.log(`  ${sess.user?.name}:`);
    console.log(`    Баллы за 5 раб.дней: ${total5Days.toFixed(1)}`);
    console.log(`    Ставка = (${total5Days.toFixed(1)}/40)×0.9 = ${rate.toFixed(2)} б/час`);
    console.log(`    С коэф.дня (${todayCoef.toFixed(2)}): ${ptsPerHour.toFixed(2)} б/час`);
    console.log(`    За 10 мин: ${ptsPer10Min.toFixed(2)} б, за 1 час: ${ptsPerHour.toFixed(2)} б`);
    console.log('');
  }

  console.log('--- Формула ---');
  console.log('  ставка = (сумма баллов за 5 раб.дней / 40) × 0.9');
  console.log('  баллы = (время в часах) × ставка × коэффициент_дня');
  console.log('  Если мало баллов: 1) мало истории за 5 дней, 2) низкий коэф.дня (Пн/Пт)');
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
