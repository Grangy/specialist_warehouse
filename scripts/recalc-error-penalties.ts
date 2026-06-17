/**
 * Пересчёт error_penalty_adjustments.
 *
 * По умолчанию — ТОЛЬКО сегодня (МСК): старые дни в adj не трогаем.
 *
 * Запуск:
 *   npx tsx scripts/recalc-error-penalties.ts
 *   npx tsx scripts/recalc-error-penalties.ts --backfill-today-admin-login=J-SkaR
 *   npx tsx scripts/recalc-error-penalties.ts --audit-today
 *   npx tsx scripts/recalc-error-penalties.ts --week
 *   npx tsx scripts/recalc-error-penalties.ts --days=7
 *   npx tsx scripts/recalc-error-penalties.ts --full   # весь период (осторожно!)
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  getErrorPenaltiesMapForPeriod,
  getErrorPenaltyForPeriod,
  mergeErrorPenaltiesReplaceDate,
  parseErrorPenaltyAdjustments,
} from '../src/lib/ranking/errorPenalties';
import {
  buildErrorPenaltyAdjustmentsAll,
  buildErrorPenaltyAdjustmentsForRange,
} from '../src/lib/ranking/buildErrorPenaltyAdjustments';
import { getStatisticsDateRange, getStatisticsDateRangeForDate, getMoscowDateString } from '../src/lib/utils/moscowDate';
import {
  CHECKER_BONUS_COLLECTOR_ERROR_REGULAR,
  CHECKER_PENALTY_ADMIN_FOUND,
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

function parseArg(name: string): string | null {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(pref)) return a.slice(pref.length).trim();
  }
  return null;
}

async function backfillTodayAdminRegistrar(login: string, range: { startDate: Date; endDate: Date }) {
  const adminUser = await prisma.user.findFirst({
    where: { login, role: 'admin' },
    select: { id: true, name: true },
  });
  if (!adminUser) {
    console.error(`Админ login="${login}" (role=admin) не найден`);
    process.exit(1);
  }
  const updated = await prisma.collectorCall.updateMany({
    where: {
      source: 'admin',
      registeredById: null,
      OR: [
        { confirmedAt: { gte: range.startDate, lte: range.endDate } },
        {
          confirmedAt: null,
          calledAt: { gte: range.startDate, lte: range.endDate },
        },
      ],
    },
    data: { registeredById: adminUser.id },
  });
  console.log(`backfill registeredById: ${login} (${adminUser.name}) — обновлено вызовов: ${updated.count}\n`);
}

function parseDaysArg(): number | null {
  const raw = parseArg('days');
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 366) {
    console.error('--days должно быть целым числом от 1 до 366');
    process.exit(1);
  }
  return n;
}

function listMoscowDateStringsInclusive(endDateStr: string, days: number): string[] {
  const [y, m, d] = endDateStr.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dates: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const dt = new Date(end);
    dt.setUTCDate(dt.getUTCDate() - i);
    dates.push(getMoscowDateString(dt));
  }
  return dates;
}

async function main() {
  const fullRebuild = process.argv.includes('--full');
  const auditToday = process.argv.includes('--audit-today');
  const monthRebuild = process.argv.includes('--month');
  const weekRebuild = process.argv.includes('--week');
  const backfillLogin = parseArg('backfill-today-admin-login');
  const daysArg = monthRebuild || weekRebuild ? null : parseDaysArg();

  const todayRange = getStatisticsDateRange('today');
  const todayStr = getMoscowDateString();

  if (backfillLogin) {
    await backfillTodayAdminRegistrar(backfillLogin, todayRange);
  }

  console.log('\n=== Пересчёт error_penalty_adjustments ===\n');
  if (fullRebuild) {
    console.log('Режим: --full (все даты, перезапись всего adj)\n');
  } else if (monthRebuild) {
    const monthRange = getStatisticsDateRange('month');
    const monthStartStr = getMoscowDateString(monthRange.startDate);
    console.log(`Режим: текущий месяц с ${monthStartStr} (МСК), остальные дни сохраняются\n`);
  } else if (weekRebuild) {
    console.log('Режим: последние 7 дней (МСК), остальные дни сохраняются\n');
  } else if (daysArg) {
    console.log(`Режим: последние ${daysArg} дней (МСК), остальные дни сохраняются\n`);
  } else {
    console.log(`Режим: только сегодня (${todayStr}, МСК), остальные дни сохраняются\n`);
  }
  console.log('checker: сборщик −1/−5, проверяльщик +1/+5 (новенький/остальные)');
  console.log(`admin: сборщик −1/−5, проверяльщик ${CHECKER_PENALTY_ADMIN_FOUND}, +11/+15 тому админу, кто нажал (registeredById)\n`);

  const setting = await prisma.systemSettings.findUnique({
    where: { key: 'error_penalty_adjustments' },
  });
  const existing = parseErrorPenaltyAdjustments(setting?.value ?? null);

  let adj = existing;
  if (fullRebuild) {
    adj = await buildErrorPenaltyAdjustmentsAll(prisma);
  } else if (monthRebuild) {
    const monthRange = getStatisticsDateRange('month');
    const monthStartStr = getMoscowDateString(monthRange.startDate);
    const dayCount = Number(todayStr.split('-')[2]) - Number(monthStartStr.split('-')[2]) + 1;
    const dateStrings = listMoscowDateStringsInclusive(todayStr, dayCount);
    for (const dateStr of dateStrings) {
      const range = getStatisticsDateRangeForDate(dateStr);
      const patch = await buildErrorPenaltyAdjustmentsForRange(prisma, range);
      adj = mergeErrorPenaltiesReplaceDate(adj, patch, dateStr);
      console.log(`  ${dateStr}: пересчитано`);
    }
    console.log('');
  } else if (weekRebuild) {
    const dateStrings = listMoscowDateStringsInclusive(todayStr, 7);
    for (const dateStr of dateStrings) {
      const range = getStatisticsDateRangeForDate(dateStr);
      const patch = await buildErrorPenaltyAdjustmentsForRange(prisma, range);
      adj = mergeErrorPenaltiesReplaceDate(adj, patch, dateStr);
      console.log(`  ${dateStr}: пересчитано`);
    }
    console.log('');
  } else if (daysArg) {
    const dateStrings = listMoscowDateStringsInclusive(todayStr, daysArg);
    for (const dateStr of dateStrings) {
      const range = getStatisticsDateRangeForDate(dateStr);
      const patch = await buildErrorPenaltyAdjustmentsForRange(prisma, range);
      adj = mergeErrorPenaltiesReplaceDate(adj, patch, dateStr);
      console.log(`  ${dateStr}: пересчитано`);
    }
    console.log('');
  } else {
    const patch = await buildErrorPenaltyAdjustmentsForRange(prisma, todayRange);
    adj = mergeErrorPenaltiesReplaceDate(existing, patch, todayStr);
  }

  const oldMap = setting?.value
    ? getErrorPenaltiesMapForPeriod(setting.value, todayRange.startDate, todayRange.endDate)
    : new Map();
  const newMap = getErrorPenaltiesMapForPeriod(JSON.stringify(adj), todayRange.startDate, todayRange.endDate);
  const oldTodayTotal = [...oldMap.values()].reduce((a, b) => a + b, 0);
  const newTodayTotal = [...newMap.values()].reduce((a, b) => a + b, 0);

  await prisma.systemSettings.upsert({
    where: { key: 'error_penalty_adjustments' },
    create: { key: 'error_penalty_adjustments', value: JSON.stringify(adj) },
    update: { value: JSON.stringify(adj) },
  });

  console.log(`Сегодня (${todayStr}) до: ${oldTodayTotal.toFixed(2)} → после: ${newTodayTotal.toFixed(2)}`);
  console.log('Пользователей в adj (всего):', Object.keys(adj).length);

  if (auditToday) {
    console.log(`\n--- Аудит за сегодня (${todayStr}, МСК) ---\n`);
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { name: { contains: 'Сергей' } },
          { name: { contains: 'Станислав' } },
          { name: { contains: 'Дмитрий' } },
          { name: { contains: 'Палыч' } },
          { name: { contains: 'Албан' } },
          { login: 'J-SkaR' },
          { role: 'admin' },
        ],
      },
      select: { id: true, name: true, role: true, login: true },
    });
    const raw = JSON.stringify(adj);
    for (const u of users) {
      const p = getErrorPenaltyForPeriod(raw, u.id, todayRange.startDate, todayRange.endDate);
      if (Math.abs(p) >= 0.01) {
        console.log(`  ${u.name} (${u.login}, ${u.role}): ${p >= 0 ? '+' : ''}${p}`);
      }
    }
    const todayCalls = await prisma.collectorCall.findMany({
      where: {
        status: 'done',
        OR: [
          { confirmedAt: { gte: todayRange.startDate, lte: todayRange.endDate } },
          {
            confirmedAt: null,
            calledAt: { gte: todayRange.startDate, lte: todayRange.endDate },
          },
        ],
      },
      include: {
        collector: { select: { name: true } },
        checker: { select: { name: true } },
        registeredBy: { select: { name: true, login: true } },
      },
      orderBy: { confirmedAt: 'asc' },
    });
    console.log(`\nВызовов за сегодня: ${todayCalls.length}`);
    for (const c of todayCalls) {
      if ((c.errorCount ?? 0) <= 0 && (c.checkerErrorCount ?? 0) <= 0) continue;
      console.log(
        `  ${c.source} | сб:${c.collector.name} пр:${c.checker.name}` +
          (c.registeredBy ? ` адм:${c.registeredBy.name} (${c.registeredBy.login})` : ' адм:—') +
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
