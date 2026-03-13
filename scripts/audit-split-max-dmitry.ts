/**
 * Аудит раздельной сборки: Max и Дмитрий Палыч.
 * Находит совместные сборки за сегодня, показывает баллы в топе vs админке.
 *
 * Запуск: npx tsx scripts/audit-split-max-dmitry.ts
 *         npx tsx scripts/audit-split-max-dmitry.ts 2026-02-02
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getUserStats } from '../src/lib/statistics/getUserStats';
import { getStatisticsDateRangeForDate } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const DATE_ARG = process.argv[2]; // YYYY-MM-DD или пусто = сегодня

async function main() {
  const dateStr = DATE_ARG || new Date().toISOString().split('T')[0];
  const { startDate, endDate } = getStatisticsDateRangeForDate(dateStr);

  console.log('\n=== АУДИТ РАЗДЕЛЬНОЙ СБОРКИ (Max + Дмитрий Палыч) ===');
  console.log('Дата:', dateStr);
  console.log('Период:', startDate.toISOString(), '—', endDate.toISOString());
  console.log('');

  const maxUser = await prisma.user.findFirst({ where: { login: 'max' } });
  const dmitryUser = await prisma.user.findFirst({
    where: { OR: [{ login: { contains: 'dmitr' } }, { name: { contains: 'Дмитрий' } }] },
  });

  if (!maxUser) {
    console.log('⚠️  Пользователь Max (login=max) не найден');
  } else {
    console.log('Max:', maxUser.id, maxUser.name, maxUser.login);
  }
  if (!dmitryUser) {
    console.log('⚠️  Пользователь Дмитрий Палыч не найден');
  } else {
    console.log('Дмитрий:', dmitryUser.id, dmitryUser.name, dmitryUser.login);
  }
  console.log('');

  const splitTasks = await prisma.shipmentTask.findMany({
    where: {
      droppedByCollectorId: { not: null },
      OR: [
        { completedAt: { gte: startDate, lte: endDate } },
        { confirmedAt: { gte: startDate, lte: endDate } },
        { droppedAt: { gte: startDate, lte: endDate } },
      ],
    },
    include: {
      shipment: { select: { number: true, customerName: true } },
      collector: { select: { name: true, login: true } },
    },
    orderBy: { completedAt: 'desc' },
  });

  console.log('--- Заявки с раздельной сборкой за период ---');
  if (splitTasks.length === 0) {
    console.log('Нет заявок с раздельной сборкой за этот период.');
  } else {
    for (const t of splitTasks) {
      const task = t as { droppedByCollectorName?: string; collector?: { name: string } };
      console.log(`  Заказ ${t.shipment?.number}: dropped=${task.droppedByCollectorName ?? t.droppedByCollectorId}, completer=${task.collector?.name}`);
    }
  }
  console.log('');

  const statsForSplit = await prisma.taskStatistics.findMany({
    where: {
      roleType: 'collector',
      taskId: { in: splitTasks.map((t) => t.id) },
    },
    include: {
      user: { select: { id: true, name: true, login: true } },
      task: {
        select: {
          id: true,
          collectorId: true,
          droppedByCollectorId: true,
          shipment: { select: { number: true } },
        },
      },
    },
  });

  console.log('--- TaskStatistics по этим заявкам ---');
  for (const s of statsForSplit) {
    const t = s.task as { collectorId?: string; droppedByCollectorId?: string; shipment?: { number: string } };
    console.log(`  ${s.user.name} (${s.user.login}): orderPoints=${s.orderPoints}, positions=${s.positions}, shipment=${t?.shipment?.number}, collectorId=${t?.collectorId}, droppedBy=${t?.droppedByCollectorId}`);
  }
  console.log('');

  const { allRankings } = await aggregateRankings('today', undefined, dateStr);
  const maxRank = allRankings.find((r) => r.userId === maxUser?.id);
  const dmitryRank = allRankings.find((r) => r.userId === dmitryUser?.id);

  console.log('--- Топ (aggregateRankings) ---');
  if (maxRank) console.log(`  Max: points=${maxRank.points}, collectorPoints=${maxRank.collectorPoints}`);
  else console.log('  Max: не в топе');
  if (dmitryRank) console.log(`  Дмитрий: points=${dmitryRank.points}, collectorPoints=${dmitryRank.collectorPoints}`);
  else console.log('  Дмитрий: не в топе');
  console.log('');

  if (maxUser) {
    const maxAdmin = await getUserStats(maxUser.id, 'today', dateStr);
    console.log('--- Админка (getUserStats) Max ---');
    console.log(`  collector.totalPoints: ${maxAdmin.collector?.totalPoints}`);
  }
  if (dmitryUser) {
    const dmitryAdmin = await getUserStats(dmitryUser.id, 'today', dateStr);
    console.log('--- Админка (getUserStats) Дмитрий ---');
    console.log(`  collector.totalPoints: ${dmitryAdmin.collector?.totalPoints}`);
  }

  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
