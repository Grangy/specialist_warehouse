/**
 * Бэкфилл таблицы position_difficulty по прошедшим сборкам.
 *
 * Учитываются те же правила, что и в updatePositionDifficulty:
 * - только задания с completedAt и сборщиком (не админ);
 * - для Склад 3 — только сборки с completedAt >= 2026-02-02.
 *
 * По умолчанию таблица очищается и заполняется заново (без двойного учёта).
 *
 * Использование:
 *   npx tsx scripts/backfill-position-difficulty.ts
 *   npx tsx scripts/backfill-position-difficulty.ts --no-clear   # добавить к существующим (может дублировать)
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const WAREHOUSE_3_CUTOFF = new Date('2026-02-02T00:00:00.000Z');

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
  const noClear = process.argv.includes('--no-clear');

  console.log('📦 Бэкфилл position_difficulty по прошедшим сборкам');
  console.log('   Склад 3 учитывается только при completedAt >= 2026-02-02');
  if (!noClear) {
    console.log('   Таблица будет очищена и заполнена заново.');
  } else {
    console.log('   Режим --no-clear: добавление к существующим данным (риск дублирования).');
  }
  console.log('');

  if (!noClear) {
    const deleted = await prisma.positionDifficulty.deleteMany({});
    console.log(`   Очищено записей: ${deleted.count}`);
  }

  const tasks = await prisma.shipmentTask.findMany({
    where: {
      status: { not: 'new' },
      completedAt: { not: null },
      collectorId: { not: null },
    },
    include: {
      lines: { include: { shipmentLine: true } },
      collector: { select: { id: true, role: true } },
    },
    orderBy: { completedAt: 'asc' },
  });

  let skippedAdmin = 0;
  let skippedWarehouse3 = 0;
  let skippedNoStats = 0;
  let processed = 0;
  let positionsUpdated = 0;

  for (const task of tasks) {
    if (!task.completedAt || !task.collectorId) continue;
    if (task.collector?.role === 'admin') {
      skippedAdmin++;
      continue;
    }
    if (task.warehouse === 'Склад 3' && task.completedAt < WAREHOUSE_3_CUTOFF) {
      skippedWarehouse3++;
      continue;
    }
    if (!task.lines.length) continue;

    const stats = await prisma.taskStatistics.findUnique({
      where: {
        taskId_userId_roleType: {
          taskId: task.id,
          userId: task.collectorId,
          roleType: 'collector',
        },
      },
    });

    const secPerUnit =
      stats?.secPerUnit ??
      (stats?.pickTimeSec != null && stats?.units && stats.units > 0
        ? stats.pickTimeSec / stats.units
        : null);
    const secPerPos =
      stats?.secPerPos ??
      (stats?.pickTimeSec != null && stats?.positions && stats.positions > 0
        ? stats.pickTimeSec / stats.positions
        : null);
    if (secPerUnit == null && secPerPos == null) {
      skippedNoStats++;
      continue;
    }

    const now = new Date();
    for (const line of task.lines) {
      const sl = line.shipmentLine;
      if (!sl) continue;
      const sku = sl.sku || sl.name || '?';
      const name = sl.name ?? '';
      const qty = line.qty ?? 0;

      await prisma.positionDifficulty.upsert({
        where: {
          sku_warehouse: { sku, warehouse: task.warehouse },
        },
        create: {
          sku,
          name,
          warehouse: task.warehouse,
          taskCount: 1,
          sumSecPerUnit: secPerUnit ?? 0,
          sumSecPerPos: secPerPos ?? 0,
          totalUnits: qty,
          updatedAt: now,
        },
        update: {
          name,
          taskCount: { increment: 1 },
          sumSecPerUnit: { increment: secPerUnit ?? 0 },
          sumSecPerPos: { increment: secPerPos ?? 0 },
          totalUnits: { increment: qty },
          updatedAt: now,
        },
      });
      positionsUpdated++;
    }
    processed++;
  }

  console.log('');
  console.log('Итог:');
  console.log(`   Обработано заданий: ${processed}`);
  console.log(`   Обновлений позиций (upsert): ${positionsUpdated}`);
  console.log(`   Пропущено (сборщик — админ): ${skippedAdmin}`);
  console.log(`   Пропущено (Склад 3 до 2026-02-02): ${skippedWarehouse3}`);
  console.log(`   Пропущено (нет статистики): ${skippedNoStats}`);
  const totalRows = await prisma.positionDifficulty.count();
  console.log(`   Всего записей в position_difficulty: ${totalRows}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
