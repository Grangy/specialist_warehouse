/**
 * Аудит: почему Администратору с 21 ч доп. работы не начисляются баллы.
 *
 * tsx scripts/audit-admin-extra-work.ts
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

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
  const period = (process.argv[2] as 'today' | 'week' | 'month') || 'week';
  const { startDate, endDate } = getStatisticsDateRange(period);
  console.log('\n=== АУДИТ: Администратор, баллы за доп. работу ===\n');
  console.log('Период (' + period + '):', startDate.toISOString(), '—', endDate.toISOString());

  const admin = await prisma.user.findFirst({
    where: { role: 'admin' },
    select: { id: true, name: true, role: true },
  });
  if (!admin) {
    console.log('Пользователь «Администратор» не найден.');
    const users = await prisma.user.findMany({ select: { id: true, name: true } });
    console.log('Пользователи:', users.map((u) => u.name).join(', '));
    return;
  }
  console.log('Найден:', admin.name, '(', admin.role, ')\n');

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      userId: admin.id,
      status: 'stopped',
      stoppedAt: { gte: startDate, lte: endDate },
    },
    orderBy: { stoppedAt: 'asc' },
  });

  console.log('Завершённые сессии доп. работы за неделю:', sessions.length);
  let totalElapsedSec = 0;
  for (const s of sessions) {
    totalElapsedSec += s.elapsedSecBeforeLunch;
    console.log(
      `  id=${s.id.slice(0, 8)}... elapsedSec=${s.elapsedSecBeforeLunch.toFixed(0)} (${(s.elapsedSecBeforeLunch / 3600).toFixed(1)} ч) stoppedAt=${s.stoppedAt?.toISOString()}`
    );
  }
  const totalHours = totalElapsedSec / 3600;
  console.log(`\nИтого часов: ${totalHours.toFixed(1)}\n`);

  if (sessions.length === 0) {
    console.log('Сессий нет — баллы не начисляются. Проверьте stoppedAt сессий.');
    return;
  }

  const beforeDate = sessions[0].stoppedAt ?? new Date();
  const rate = await getExtraWorkRatePerHour(prisma, admin.id, beforeDate);
  const points = calculateExtraWorkPointsFromRate(totalElapsedSec, rate);

  console.log('Расчёт ставки (getExtraWorkRatePerHour):');
  console.log('  beforeDate:', beforeDate.toISOString());
  console.log('  rate (баллов/час):', rate.toFixed(4));
  console.log('  totalElapsedSec:', totalElapsedSec.toFixed(0));
  console.log('  points = (elapsedSec/3600) * rate =', points.toFixed(4));
  console.log('');

  const { allRankings } = await import('../src/lib/statistics/aggregateRankings').then((m) =>
    m.aggregateRankings(period)
  );
  const adminEntry = allRankings.find((r) => r.userId === admin.id);
  console.log('aggregateRankings("' + period + '") — admin:');
  console.log('  extraWorkPoints:', adminEntry?.extraWorkPoints ?? 'не в списке');
  console.log('  points:', adminEntry?.points ?? '—');
  console.log('');

  if (Math.abs((adminEntry?.extraWorkPoints ?? 0) - points) > 0.01) {
    console.log('⚠ РАСХОЖДЕНИЕ: ожидалось', points.toFixed(2), 'получено', (adminEntry?.extraWorkPoints ?? 0).toFixed(2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
