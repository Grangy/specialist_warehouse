/**
 * Аудит: были ли сборки сегодня у Игоря и Эрнеса, почему не в топе.
 *
 * Запуск: npx tsx scripts/audit-igor-ernes-collector.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getUserStats } from '../src/lib/statistics/getUserStats';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
}) as any;

async function main() {
  const { startDate, endDate } = getStatisticsDateRange('today');
  console.log('\n📋 Аудит сборок Игоря и Эрнеса (сегодня)');
  console.log('=========================================');
  console.log(`Период (МСК): ${startDate.toISOString()} — ${endDate.toISOString()}\n`);

  const igor = await prisma.user.findFirst({ where: { name: { contains: 'Игорь' } } });
  const ernes = await prisma.user.findFirst({ where: { name: { contains: 'Эрнес' } } });

  if (!igor) {
    console.log('❌ Пользователь Игорь не найден');
  }
  if (!ernes) {
    console.log('❌ Пользователь Эрнес не найден');
  }

  const userIds = [igor?.id, ernes?.id].filter(Boolean) as string[];
  if (userIds.length === 0) {
    console.log('Нет пользователей для проверки.');
    return;
  }

  for (const user of [igor, ernes].filter(Boolean)) {
    if (!user) continue;
    console.log(`\n👤 ${user.name} (${user.id.slice(0, 8)}..., роль: ${user.role})`);
    console.log('-'.repeat(50));

    // 1. Задания где user был сборщиком (collectorId)
    const asCollector = await prisma.shipmentTask.findMany({
      where: {
        collectorId: user.id,
        status: 'processed',
        completedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        shipment: { select: { number: true } },
        collectorId: true,
        checkerId: true,
        dictatorId: true,
        completedAt: true,
        confirmedAt: true,
      },
    });

    // 2. Задания самопроверка (checkerId=dictatorId=user) без collectorId
    const selfCheckNoCollector = await prisma.shipmentTask.findMany({
      where: {
        collectorId: null,
        checkerId: user.id,
        dictatorId: user.id,
        status: 'processed',
        confirmedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        shipment: { select: { number: true } },
        collectorId: true,
        checkerId: true,
        dictatorId: true,
        completedAt: true,
        confirmedAt: true,
      },
    });

    // 3. TaskStatistics roleType=collector для этого user за сегодня
    const collectorStats = await prisma.taskStatistics.findMany({
      where: {
        userId: user.id,
        roleType: 'collector',
        task: {
          OR: [
            { completedAt: { gte: startDate, lte: endDate } },
            { confirmedAt: { gte: startDate, lte: endDate } },
          ],
        },
      },
      include: {
        task: { select: { collectorId: true, dictatorId: true, shipment: { select: { number: true } } } },
      },
    });

    console.log(`  Заданий с collectorId=${user.name}: ${asCollector.length}`);
    if (asCollector.length > 0) {
      for (const t of asCollector) {
        const stat = collectorStats.find((s) => s.taskId === t.id);
        const hasStat = !!stat;
        const passesFilter = hasStat && (t.collectorId === user.id || !t.collectorId);
        console.log(
          `    - ${(t.shipment as { number?: string })?.number ?? t.id} | TaskStatistics: ${hasStat ? '✅' : '❌ НЕТ'} | collectorId=${t.collectorId ? 'есть' : 'null'} | проходит фильтр: ${passesFilter}`
        );
      }
    }

    console.log(`  Самопроверок без collectorId (checker=dictator): ${selfCheckNoCollector.length}`);
    if (selfCheckNoCollector.length > 0) {
      for (const t of selfCheckNoCollector) {
        const stat = collectorStats.find((s) => s.taskId === t.id);
        const hasStat = !!stat;
        console.log(
          `    - ${(t.shipment as { number?: string })?.number ?? t.id} | TaskStatistics: ${hasStat ? '✅' : '❌ НЕТ (нужен backfill!)'} | collectorId=null`
        );
      }
    }

    console.log(`  TaskStatistics (collector) за сегодня: ${collectorStats.length}`);
    if (collectorStats.length > 0) {
      let totalPts = 0;
      for (const s of collectorStats) {
        const t = s.task as { collectorId?: string; dictatorId?: string; shipment?: { number: string } };
        const passesFilter = t?.collectorId === user.id || t?.collectorId == null;
        totalPts += s.orderPoints ?? 0;
        console.log(
          `    - ${t?.shipment?.number ?? s.taskId} | ${(s.orderPoints ?? 0).toFixed(2)} б. | task.collectorId=${t?.collectorId ?? 'null'} | в топ: ${passesFilter ? 'да' : 'нет'}`
        );
      }
      console.log(`  Итого баллов сборки: ${totalPts.toFixed(2)}`);
    } else {
      console.log('  ⚠️ Нет TaskStatistics → в топе сборка = 0');
    }
  }

  // 4. getUserStats (для «Подробнее» и модалки)
  console.log('\n📊 getUserStats (блок Подробнее / модалка):');
  console.log('-'.repeat(50));
  for (const user of [igor, ernes].filter(Boolean)) {
    if (!user) continue;
    const stats = await getUserStats(user.id, 'week');
    if (stats) {
      console.log(`  ${user.name} (week): collector ${stats.collector.totalTasks} зак., ${stats.collector.totalPoints.toFixed(2)} б.`);
    } else {
      console.log(`  ${user.name}: null`);
    }
  }

  // 5. Что реально возвращает aggregateRankings для today и week
  console.log('\n📊 API топа (aggregateRankings):');
  console.log('-'.repeat(50));
  for (const p of ['today', 'week'] as const) {
    const { allRankings } = await aggregateRankings(p);
    const igorEntry = allRankings.find((r) => r.userName.includes('Игорь'));
    const ernesEntry = allRankings.find((r) => r.userName.includes('Эрнес'));
    console.log(`  Период "${p}":`);
    if (igorEntry) {
      console.log(`    Игорь: points=${igorEntry.points.toFixed(2)}, collectorPoints=${igorEntry.collectorPoints.toFixed(2)}, checkerPoints=${igorEntry.checkerPoints.toFixed(2)}`);
    } else {
      console.log('    Игорь: не в списке');
    }
    if (ernesEntry) {
      console.log(`    Эрнес: points=${ernesEntry.points.toFixed(2)}, collectorPoints=${ernesEntry.collectorPoints.toFixed(2)}, checkerPoints=${ernesEntry.checkerPoints.toFixed(2)}`);
    } else {
      console.log('    Эрнес: не в списке');
    }
  }

  console.log('\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
