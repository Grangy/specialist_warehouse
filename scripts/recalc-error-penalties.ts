/**
 * Пересчёт error_penalty_adjustments по CollectorCall.
 * Даты — день фиксации ошибки (МСК), не дата заказа.
 *
 * Запуск:
 *   npx tsx scripts/recalc-error-penalties.ts
 *   npx tsx scripts/recalc-error-penalties.ts --orphan-admin-login=admin
 *   npx tsx scripts/recalc-error-penalties.ts --audit-today
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getErrorPenaltiesMapForPeriod, getErrorPenaltyForPeriod } from '../src/lib/ranking/errorPenalties';
import { buildErrorPenaltyAdjustments } from '../src/lib/ranking/buildErrorPenaltyAdjustments';
import { getStatisticsDateRange, getMoscowDateString } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

function parseArg(name: string): string | null {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(pref)) return a.slice(pref.length).trim();
  }
  return null;
}

async function main() {
  const orphanLogin = parseArg('orphan-admin-login');
  const auditToday = process.argv.includes('--audit-today');
  let orphanAdminUserId: string | null = null;
  if (orphanLogin) {
    const u = await prisma.user.findFirst({ where: { login: orphanLogin }, select: { id: true, name: true } });
    if (!u) {
      console.error(`Пользователь login="${orphanLogin}" не найден`);
      process.exit(1);
    }
    orphanAdminUserId = u.id;
    console.log(`orphan-admin: ${orphanLogin} (${u.name})\n`);
  }

  console.log('\n=== Пересчёт error_penalty_adjustments ===\n');
  console.log('checker: сборщик −1/−5, проверяльщик +5 (дата = confirmedAt СОС)');
  console.log('admin: сборщик −1/−5, проверяльщик −10, админ +11/+15 (дата = клик в админке)\n');

  const adj = await buildErrorPenaltyAdjustments(prisma, { orphanAdminUserId });

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
  console.log('Пользователей в adj:', Object.keys(adj).length);

  if (auditToday) {
    const { startDate, endDate } = getStatisticsDateRange('today');
    const todayStr = getMoscowDateString();
    console.log(`\n--- Аудит за сегодня (${todayStr}, МСК) ---\n`);
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: 'Сергей' } },
          { name: { contains: 'Станислав' } },
          { role: 'admin' },
        ],
      },
      select: { id: true, name: true, role: true },
    });
    const raw = JSON.stringify(adj);
    for (const u of users) {
      const p = getErrorPenaltyForPeriod(raw, u.id, startDate, endDate);
      if (Math.abs(p) >= 0.01) {
        console.log(`  ${u.name} (${u.role}): ${p >= 0 ? '+' : ''}${p}`);
      }
    }
    const todayCalls = await prisma.collectorCall.findMany({
      where: {
        status: 'done',
        confirmedAt: { gte: startDate, lte: endDate },
      },
      include: {
        collector: { select: { name: true } },
        checker: { select: { name: true } },
        registeredBy: { select: { name: true } },
      },
      orderBy: { confirmedAt: 'asc' },
    });
    console.log(`\nВызовов с confirmedAt сегодня: ${todayCalls.length}`);
    for (const c of todayCalls) {
      if ((c.errorCount ?? 0) <= 0 && (c.checkerErrorCount ?? 0) <= 0) continue;
      console.log(
        `  ${c.source} | сб:${c.collector.name} пр:${c.checker.name}` +
          (c.registeredBy ? ` адм:${c.registeredBy.name}` : '') +
          ` err=${c.errorCount ?? 0} chkErr=${c.checkerErrorCount ?? 0}`
      );
    }
  }

  console.log('\n=== Готово ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
