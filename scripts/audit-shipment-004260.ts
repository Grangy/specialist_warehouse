/**
 * Аудит сборки ИПУТ-004260 — Гречишкина Ирина Павловна.
 * Анализ раздельной сборки: Maximilliano Del Torro и Дмитрий Палыч.
 *
 * Запуск: npx tsx scripts/audit-shipment-004260.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getUserStats } from '../src/lib/statistics/getUserStats';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const SHIPMENT_NUMBER = 'ИПУТ-004260';

async function main() {
  console.log('\n=== АУДИТ СБОРКИ ИПУТ-004260 — Гречишкина Ирина Павловна ===\n');

  const shipment = await prisma.shipment.findFirst({
    where: { number: { contains: '004260' } },
    include: {
      tasks: {
        include: {
          collector: { select: { id: true, name: true, login: true } },
          checker: { select: { id: true, name: true } },
          dictator: { select: { id: true, name: true } },
          statistics: {
            include: { user: { select: { id: true, name: true, login: true } } },
          },
        },
      },
    },
  });

  if (!shipment) {
    console.log('⚠️  Заказ ИПУТ-004260 не найден в БД.');
    await prisma.$disconnect();
    return;
  }

  console.log('--- Заказ ---');
  console.log(`  Номер: ${shipment.number}`);
  console.log(`  Клиент: ${shipment.customerName}`);
  console.log(`  confirmedAt: ${shipment.confirmedAt?.toISOString() ?? '—'}`);
  console.log('');

  for (const task of shipment.tasks) {
    const t = task as { droppedByCollectorId?: string | null; droppedByCollectorName?: string | null; droppedAt?: Date | null };
    console.log('--- Задание (task) ---');
    console.log(`  id: ${task.id}`);
    console.log(`  warehouse: ${task.warehouse}`);
    console.log(`  collectorId: ${task.collectorId} (${task.collector?.name})`);
    console.log(`  droppedByCollectorId: ${t.droppedByCollectorId}`);
    console.log(`  droppedByCollectorName: ${t.droppedByCollectorName ?? '—'}`);
    console.log(`  droppedAt: ${t.droppedAt?.toISOString() ?? '—'}`);
    console.log(`  startedAt: ${task.startedAt?.toISOString() ?? '—'}`);
    console.log(`  completedAt: ${task.completedAt?.toISOString() ?? '—'}`);
    console.log(`  confirmedAt: ${task.confirmedAt?.toISOString() ?? '—'}`);
    console.log('');

    console.log('  TaskStatistics (по этому заданию):');
    for (const stat of task.statistics) {
      console.log(`    - ${stat.user.name} (${stat.user.login}): roleType=${stat.roleType}, positions=${stat.positions}, orderPoints=${stat.orderPoints}`);
    }
    console.log('');
  }

  const maxUser = await prisma.user.findFirst({ where: { login: 'max' } });
  const dmitryUser = await prisma.user.findFirst({
    where: { OR: [{ login: { contains: 'dmitr' } }, { name: { contains: 'Дмитрий' } }] },
  });

  const taskDate = shipment.tasks[0]?.completedAt?.toISOString()?.split('T')[0] ?? shipment.confirmedAt?.toISOString()?.split('T')[0] ?? new Date().toISOString().split('T')[0];

  console.log('--- Статистика: Maximilliano Del Torro (Max) ---');
  if (maxUser) {
    const maxAdmin = await getUserStats(maxUser.id, 'today', taskDate);
    const collectorTasks = maxAdmin.collector?.tasks ?? [];
    const task004260 = collectorTasks.filter((t: { shipmentNumber: string }) => t.shipmentNumber?.includes('004260'));
    console.log(`  Админка (getUserStats) collector.totalPoints: ${maxAdmin.collector?.totalPoints}`);
    if (task004260.length > 0) {
      console.log(`  Заказ ИПУТ-004260 в коллекции Max:`);
      for (const t of task004260) {
        console.log(`    - ${t.shipmentNumber}: ${t.orderPoints} б. (${t.positions} поз.)`);
      }
    } else {
      console.log(`  Заказ ИПУТ-004260 в коллекции Max: не найден (период может не совпадать)`);
    }
  } else {
    console.log('  Max не найден');
  }
  console.log('');

  console.log('--- Статистика: Дмитрий Палыч ---');
  if (dmitryUser) {
    const dmitryAdmin = await getUserStats(dmitryUser.id, 'today', taskDate);
    const collectorTasks = dmitryAdmin.collector?.tasks ?? [];
    const task004260 = collectorTasks.filter((t: { shipmentNumber: string }) => t.shipmentNumber?.includes('004260'));
    console.log(`  Админка (getUserStats) collector.totalPoints: ${dmitryAdmin.collector?.totalPoints}`);
    if (task004260.length > 0) {
      console.log(`  Заказ ИПУТ-004260 в коллекции Дмитрий:`);
      for (const t of task004260) {
        console.log(`    - ${t.shipmentNumber}: ${t.orderPoints} б. (${t.positions} поз.)`);
      }
    } else {
      console.log(`  Заказ ИПУТ-004260 в коллекции Дмитрий: не найден (период может не совпадать)`);
    }
  } else {
    console.log('  Дмитрий не найден');
  }
  console.log('');

  const { allRankings } = await aggregateRankings('today', undefined, taskDate);
  const maxRank = allRankings.find((r) => r.userId === maxUser?.id);
  const dmitryRank = allRankings.find((r) => r.userId === dmitryUser?.id);

  console.log('--- Топ (aggregateRankings) за период ---');
  if (maxRank) console.log(`  Max: points=${maxRank.points}, collectorPoints=${maxRank.collectorPoints}`);
  else console.log('  Max: не в топе');
  if (dmitryRank) console.log(`  Дмитрий: points=${dmitryRank.points}, collectorPoints=${dmitryRank.collectorPoints}`);
  else console.log('  Дмитрий: не в топе');
  console.log('');

  console.log('--- Итог по ИПУТ-004260 ---');
  const stats004260 = shipment.tasks.flatMap((t) => t.statistics).filter((s) => s.roleType === 'collector');
  const total = stats004260.reduce((sum, s) => sum + (s.orderPoints ?? 0), 0);
  console.log(`  Всего TaskStatistics (collector) по заказу: ${stats004260.length}`);
  console.log(`  Сумма orderPoints: ${total}`);
  for (const s of stats004260) {
    console.log(`    - ${s.user.name}: ${s.orderPoints} б. (${s.positions} поз.)`);
  }
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
