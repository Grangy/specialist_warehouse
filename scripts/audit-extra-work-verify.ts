/**
 * Проверка расчёта баллов за доп. работу.
 * npx tsx --env-file=.env scripts/audit-extra-work-verify.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getLast5WorkingDaysMoscow } from '../src/lib/utils/moscowDate';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

async function main() {
  const sessions = await prisma.extraWorkSession.findMany({
    where: { status: 'stopped' },
    include: { user: { select: { name: true, role: true } } },
    orderBy: { stoppedAt: 'desc' },
    take: 5,
  });

  console.log('\n=== Проверка расчёта доп. работы ===\n');
  console.log('Формула: ставка = (сумма баллов за 5 раб.дней / 40) × 0.9');
  console.log('         баллы = (elapsedSec / 3600) × ставка\n');

  for (const s of sessions) {
    const beforeDate = s.stoppedAt ?? new Date();
    const rate = await getExtraWorkRatePerHour(prisma, s.userId, beforeDate);

    // Показать 5 рабочих дней и сумму баллов
    const days = getLast5WorkingDaysMoscow(beforeDate);
    let totalPoints = 0;
    for (const day of days) {
      const [c, ch, d] = await Promise.all([
        prisma.taskStatistics.aggregate({
          where: {
            userId: s.userId,
            roleType: 'collector',
            task: { OR: [{ completedAt: { gte: day.start, lte: day.end } }, { confirmedAt: { gte: day.start, lte: day.end } }] },
          },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: { userId: s.userId, roleType: 'checker', task: { confirmedAt: { gte: day.start, lte: day.end } } },
          _sum: { orderPoints: true },
        }),
        prisma.taskStatistics.aggregate({
          where: { userId: s.userId, roleType: 'dictator', task: { confirmedAt: { gte: day.start, lte: day.end } } },
          _sum: { orderPoints: true },
        }),
      ]);
      const dayPts = (c._sum.orderPoints ?? 0) + (ch._sum.orderPoints ?? 0) + (d._sum.orderPoints ?? 0);
      totalPoints += dayPts;
    }

    const expectedRate = (totalPoints / 40) * 0.9;
    const points = calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch, rate);

    console.log(`👤 ${s.user.name} (${s.user.role})`);
    console.log(`   stoppedAt: ${s.stoppedAt?.toISOString()}`);
    console.log(`   5 раб.дней: сумма баллов = ${totalPoints.toFixed(2)}`);
    console.log(`   ставка = (${totalPoints.toFixed(2)} / 40) × 0.9 = ${expectedRate.toFixed(2)} баллов/час`);
    console.log(`   getExtraWorkRatePerHour вернул: ${rate.toFixed(2)}`);
    console.log(`   elapsedSecBeforeLunch: ${s.elapsedSecBeforeLunch.toFixed(0)} сек (${(s.elapsedSecBeforeLunch / 60).toFixed(1)} мин)`);
    console.log(`   баллы = (${s.elapsedSecBeforeLunch.toFixed(0)} / 3600) × ${rate.toFixed(2)} = ${points.toFixed(4)}`);
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
