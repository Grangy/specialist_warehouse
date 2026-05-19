/**
 * Пересчёт error_penalty_adjustments по данным CollectorCall.
 * Схема:
 * - source='checker': позиция с errorCount>0 => сборщик −1/−5, проверяльщик +5
 * - source='admin' (checkerErrorCount>0): сборщик −1/−5, проверяльщик −10
 *   (баллы админу +11/+15 в CollectorCall не хранятся — не пересчитываются)
 *
 * Считаем по позициям (errorCount>0 / checkerErrorCount>0), не по количеству.
 *
 * Запуск: npx tsx scripts/recalc-error-penalties.ts
 *         npm run recalc:error-penalties
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getErrorPenaltiesMapForPeriod } from '../src/lib/ranking/errorPenalties';
import { isCollectorNewbie } from '../src/lib/ranking/isNewbie';
import {
  CHECKER_BONUS_COLLECTOR_ERROR,
  CHECKER_PENALTY_ADMIN_FOUND,
  COLLECTOR_ERROR_NEWBIE,
  COLLECTOR_ERROR_REGULAR,
} from '../src/lib/ranking/errorPointRates';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function main() {
  console.log('\n=== Пересчёт error_penalty_adjustments ===\n');
  console.log('Схема: checker → сборщик −1/−5, проверяльщик +5');
  console.log('        admin → сборщик −1/−5, проверяльщик −10 (без баллов админа)\n');

  const calls = await prisma.collectorCall.findMany({
    where: {
      status: 'done',
      source: 'checker',
      errorCount: { gt: 0 },
    },
    include: {
      task: {
        include: {
          shipment: { select: { confirmedAt: true } },
        },
      },
    },
  });

  console.log(`Найдено CollectorCall (checker, status=done, errorCount>0): ${calls.length}\n`);

  const adj: Record<string, Array<{ points: number; date: string }>> = {};

  for (const call of calls) {
    // Позиционный учет: любой errorCount > 0 считаем как 1 ошибочную позицию.
    const errCount = (call.errorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const date = call.task?.shipment?.confirmedAt ?? call.confirmedAt ?? new Date();
    const dateStr = toDateStr(date instanceof Date ? date : new Date(date));

    const collId = call.collectorId;
    const checkId = call.checkerId;

    const collPenalty = (await isCollectorNewbie(collId)) ? COLLECTOR_ERROR_NEWBIE : COLLECTOR_ERROR_REGULAR;

    if (!adj[collId]) adj[collId] = [];
    adj[collId].push({ points: collPenalty * errCount, date: dateStr });

    if (!adj[checkId]) adj[checkId] = [];
    adj[checkId].push({ points: CHECKER_BONUS_COLLECTOR_ERROR * errCount, date: dateStr });
  }

  const adminCalls = await prisma.collectorCall.findMany({
    where: {
      status: 'done',
      source: 'admin',
      checkerErrorCount: { gt: 0 },
    },
    include: {
      task: {
        include: {
          shipment: { select: { confirmedAt: true } },
        },
      },
    },
  });

  console.log(`Найдено CollectorCall (admin, checkerErrorCount>0): ${adminCalls.length}\n`);

  for (const call of adminCalls) {
    const errCount = (call.checkerErrorCount ?? 0) > 0 ? 1 : 0;
    if (errCount === 0) continue;
    const date = call.task?.shipment?.confirmedAt ?? call.confirmedAt ?? new Date();
    const dateStr = toDateStr(date instanceof Date ? date : new Date(date));
    const collPenalty = (await isCollectorNewbie(call.collectorId))
      ? COLLECTOR_ERROR_NEWBIE
      : COLLECTOR_ERROR_REGULAR;

    if (!adj[call.collectorId]) adj[call.collectorId] = [];
    adj[call.collectorId].push({ points: collPenalty * errCount, date: dateStr });

    if (!adj[call.checkerId]) adj[call.checkerId] = [];
    adj[call.checkerId].push({ points: CHECKER_PENALTY_ADMIN_FOUND * errCount, date: dateStr });
  }

  const setting = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });

  const oldRaw = setting?.value ?? null;
  const oldMap = oldRaw ? getErrorPenaltiesMapForPeriod(oldRaw, new Date(0), new Date(9999, 11, 31)) : new Map();
  const oldTotal = [...oldMap.values()].reduce((a, b) => a + b, 0);

  await prisma.systemSettings.upsert({
    where: { key: 'error_penalty_adjustments' },
    create: { key: 'error_penalty_adjustments', value: JSON.stringify(adj) },
    update: { value: JSON.stringify(adj) },
  });

  const newMap = getErrorPenaltiesMapForPeriod(JSON.stringify(adj), new Date(0), new Date(9999, 11, 31));
  const newTotal = [...newMap.values()].reduce((a, b) => a + b, 0);

  console.log('До пересчёта (сумма по всем):', oldTotal.toFixed(2));
  console.log('После пересчёта (сумма по всем):', newTotal.toFixed(2));
  console.log('\nЗаписей в adj:', Object.keys(adj).length, 'пользователей');
  console.log('\n=== Готово ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
