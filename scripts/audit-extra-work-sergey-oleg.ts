/**
 * Аудит: почему Сергею и Олегу не записались баллы за доп. работу.
 * Запуск: npx tsx scripts/audit-extra-work-sergey-oleg.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import { getExtraWorkRatePerHour, calculateExtraWorkPointsFromRate } from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';

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
  const sergey = await prisma.user.findFirst({ where: { name: { contains: 'Сергей' } } });
  const oleg = await prisma.user.findFirst({ where: { name: { contains: 'Олег' } } });

  if (!sergey || !oleg) {
    console.log('Сергей или Олег не найдены');
    return;
  }

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      userId: { in: [sergey.id, oleg.id] },
      status: 'stopped',
      stoppedAt: { not: null },
    },
    orderBy: { stoppedAt: 'desc' },
    take: 10,
    include: { user: { select: { name: true } } },
  });

  console.log('\n=== Аудит доп. работы: Сергей, Олег ===\n');

  for (const s of sessions) {
    const user = s.user;
    const elapsed = s.elapsedSecBeforeLunch ?? 0;
    const stoppedAt = s.stoppedAt!;
    const rate = await getExtraWorkRatePerHour(prisma, s.userId, stoppedAt);
    const dayCoef = await getWeekdayCoefficientForDate(prisma, stoppedAt);
    const pts = calculateExtraWorkPointsFromRate(Math.max(0, elapsed), rate, dayCoef);

    console.log(`${user.name}:`);
    console.log(`  stoppedAt: ${stoppedAt.toISOString()}`);
    console.log(`  elapsedSecBeforeLunch: ${elapsed} (${elapsed < 0 ? '⚠️ ОТРИЦАТЕЛЬНО!' : 'OK'})`);
    console.log(`  rate: ${rate.toFixed(2)} баллов/час`);
    console.log(`  dayCoef: ${dayCoef}`);
    console.log(`  points: ${pts.toFixed(2)}`);
    console.log('');
  }

  console.log('Вывод: если elapsedSecBeforeLunch отрицательный — баллы = 0 (Math.max(0,...)).');
  console.log('Причина: ошибка при остановке сессии (неверный расчёт totalElapsedSec).');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
