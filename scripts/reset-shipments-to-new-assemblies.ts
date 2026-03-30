#!/usr/bin/env npx tsx
/**
 * Вернуть заказы "из подтверждений" обратно в "новые сборки".
 *
 * Что делает (для указанных shipment.number):
 * - shipment: status='new', confirmedAt=null, deleted=false (не трогаем deletedAt, если был)
 * - shipment lines: collectedQty=null, checked=false, confirmedQty=null, confirmed=false
 * - shipment tasks: status='new', сброс collector/checker/dictator/тайминги/places/dropped
 * - task lines: collectedQty=null, checked=false, confirmedQty=null, confirmed=false
 * - удаляет lock-и по заказу/задачам
 * - удаляет taskStatistics по этим задачам (чтобы не было "фантомных" баллов)
 *
 * По умолчанию: dry-run (ничего не пишет).
 * Для применения: добавь --apply
 *
 * Пример:
 *   npx tsx scripts/reset-shipments-to-new-assemblies.ts --apply ИПУТ-005554 ИПУТ-005565
 */

import './loadEnv';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function getArgsNumbers(): string[] {
  return process.argv
    .slice(2)
    .filter((a) => a && !a.startsWith('--'))
    .map((s) => s.trim())
    .filter(Boolean);
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    const dbPath = databaseUrl.replace('file:', '');
    finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
  });

  const apply = hasFlag('--apply');
  const numbers = uniq(getArgsNumbers());
  if (numbers.length === 0) {
    console.error(
      'Укажи номера заказов. Пример:\n  npx tsx scripts/reset-shipments-to-new-assemblies.ts --apply ИПУТ-005554 ИПУТ-005565'
    );
    process.exit(1);
  }

  console.log(`\nReset shipments -> NEW assemblies`);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Shipments: ${numbers.join(', ')}`);

  const shipments = await prisma.shipment.findMany({
    where: { number: { in: numbers } },
    include: {
      tasks: { select: { id: true, status: true, warehouse: true, collectorId: true, checkerId: true, completedAt: true, confirmedAt: true } },
    },
  });

  const foundNums = new Set(shipments.map((s) => s.number));
  const missing = numbers.filter((n) => !foundNums.has(n));
  if (missing.length > 0) {
    console.log(`\n⚠️ Не найдены в БД: ${missing.join(', ')}`);
  }

  for (const s of shipments) {
    console.log(`\n- ${s.number} (id=${s.id}) status=${s.status} deleted=${s.deleted ? 'true' : 'false'} tasks=${s.tasks.length}`);
    const taskStatuses = s.tasks.reduce<Record<string, number>>((acc, t) => {
      acc[t.status] = (acc[t.status] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`  task status breakdown: ${Object.entries(taskStatuses).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`);
  }

  if (!apply) {
    console.log('\nDry-run: изменения НЕ применены. Добавь --apply чтобы записать в БД.\n');
    await prisma.$disconnect();
    return;
  }

  for (const s of shipments) {
    const taskIds = s.tasks.map((t) => t.id);
    await prisma.$transaction(async (tx) => {
      // Locks
      await tx.shipmentLock.deleteMany({ where: { shipmentId: s.id } });
      if (taskIds.length > 0) {
        await tx.shipmentTaskLock.deleteMany({ where: { taskId: { in: taskIds } } });
      }

      // Stats (important for ranking correctness)
      if (taskIds.length > 0) {
        await tx.taskStatistics.deleteMany({ where: { taskId: { in: taskIds } } });
      }

      // Reset task lines
      if (taskIds.length > 0) {
        await tx.shipmentTaskLine.updateMany({
          where: { taskId: { in: taskIds } },
          data: {
            collectedQty: null,
            checked: false,
            confirmedQty: null,
            confirmed: false,
          },
        });
      }

      // Reset tasks
      if (taskIds.length > 0) {
        await tx.shipmentTask.updateMany({
          where: { id: { in: taskIds } },
          data: {
            status: 'new',
            collectorId: null,
            collectorName: null,
            startedAt: null,
            completedAt: null,
            checkerName: null,
            checkerId: null,
            checkerStartedAt: null,
            dictatorId: null,
            confirmedAt: null,
            places: null,
            droppedByCollectorId: null,
            droppedByCollectorName: null,
            droppedAt: null,
            updatedAt: new Date(),
          },
        });
      }

      // Reset shipment lines
      await tx.shipmentLine.updateMany({
        where: { shipmentId: s.id },
        data: {
          collectedQty: null,
          checked: false,
          confirmedQty: null,
          confirmed: false,
        },
      });

      // Reset shipment itself
      await tx.shipment.update({
        where: { id: s.id },
        data: {
          status: 'new',
          confirmedAt: null,
          deleted: false,
          // collectorName в Shipment — это "общий" сборщик заказа; сбрасываем, чтобы UI не путался
          collectorName: null,
          places: null,
        },
      });
    });

    console.log(`  ✅ applied: ${s.number}`);
  }

  console.log('\nDone.\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

