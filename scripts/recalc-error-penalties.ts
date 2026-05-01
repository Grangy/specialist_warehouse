/**
 * Пересчёт error_penalty_adjustments по данным CollectorCall.
 * Схема:
 * - source='checker': ошибочная ПОЗИЦИЯ (errorCount>0) => сборщик −1, проверяльщик +1
 *
 * Важно: считаем по позициям, а не по количеству товара.
 * source='admin' здесь не пересчитывается (adminId не хранится в CollectorCall).
 *
 * Запуск: npx tsx scripts/recalc-error-penalties.ts
 *         npm run recalc:error-penalties
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getErrorPenaltiesMapForPeriod } from '../src/lib/ranking/errorPenalties';

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
  console.log('Схема: source=checker: позиция => сборщик −1, проверяльщик +1');
  console.log('Считаем по позициям (errorCount>0), не по количеству.');
  console.log('source=admin не пересчитывается этим скриптом.\n');

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

    if (!adj[collId]) adj[collId] = [];
    adj[collId].push({ points: -1 * errCount, date: dateStr });

    if (!adj[checkId]) adj[checkId] = [];
    adj[checkId].push({ points: 1 * errCount, date: dateStr });
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
