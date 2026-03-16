/**
 * Аудит доп. работы: что отображается у людей с назначенной доп. работой.
 * Проверяет: сессии, баллы, ручные корректировки, aggregateRankings, API extra-work.
 *
 * Запуск: npx tsx scripts/audit-extra-work-display.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';
import { getManualAdjustmentsMapForPeriod } from '../src/lib/ranking/manualAdjustments';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== АУДИТ ДОП. РАБОТЫ: что отображается ===\n');

  const activeSessions = await prisma.extraWorkSession.findMany({
    where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
    include: { user: { select: { id: true, name: true, login: true } } },
  });

  const stoppedThisWeek = await prisma.extraWorkSession.findMany({
    where: { status: 'stopped' },
    include: { user: { select: { id: true, name: true, login: true } } },
  });

  const { startDate: weekStart, endDate: weekEnd } = getStatisticsDateRange('week');
  const stoppedInPeriod = stoppedThisWeek.filter(
    (s) => s.stoppedAt && s.stoppedAt >= weekStart && s.stoppedAt <= weekEnd
  );

  const userIds = new Set<string>();
  for (const s of activeSessions) userIds.add(s.userId);
  for (const s of stoppedInPeriod) userIds.add(s.userId);

  console.log('--- Активные сессии (сейчас) ---');
  if (activeSessions.length === 0) {
    console.log('  Нет активных сессий');
  } else {
    for (const s of activeSessions) {
      console.log(`  ${s.user?.name} (${s.user?.login}): status=${s.status}, elapsedSecBeforeLunch=${s.elapsedSecBeforeLunch}`);
    }
  }
  console.log('');

  console.log('--- Остановленные сессии за неделю ---');
  for (const s of stoppedInPeriod) {
    const rate = await getExtraWorkRatePerHour(prisma, s.userId, s.stoppedAt ?? new Date());
    const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
    const pts = calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef);
    console.log(`  ${s.user?.name}: elapsedSec=${s.elapsedSecBeforeLunch}, pts=${pts.toFixed(2)}, stoppedAt=${s.stoppedAt?.toISOString()}`);
  }
  console.log('');

  const manualSetting = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_manual_adjustments' },
  });
  const manualMap = getManualAdjustmentsMapForPeriod(manualSetting?.value ?? null, weekStart, weekEnd);
  console.log('--- Ручные корректировки за неделю ---');
  if (manualMap.size === 0) {
    console.log('  Нет');
  } else {
    for (const [uid, delta] of manualMap) {
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
      console.log(`  ${u?.name ?? uid}: delta=${delta}`);
    }
  }
  console.log('');

  const { allRankings } = await aggregateRankings('week');
  const extraWorkUsers = allRankings.filter((r) => (r.extraWorkPoints ?? 0) !== 0);

  console.log('--- aggregateRankings (week) — extraWorkPoints ---');
  for (const r of extraWorkUsers) {
    const neg = (r.extraWorkPoints ?? 0) < 0 ? ' ⚠️ ОТРИЦАТЕЛЬНО' : '';
    console.log(`  ${r.userName}: extraWorkPoints=${r.extraWorkPoints?.toFixed(2) ?? 0}, points=${r.points?.toFixed(2) ?? 0}${neg}`);
  }
  if (extraWorkUsers.length === 0) {
    console.log('  Нет пользователей с доп. работой в топе');
  }
  console.log('');

  console.log('--- Все с extraWorkPoints (включая 0 и отрицательные) ---');
  const anyExtra = allRankings.filter((r) => r.extraWorkPoints != null);
  for (const r of anyExtra) {
    const val = r.extraWorkPoints ?? 0;
    if (val <= 0 || Math.abs(val) < 0.01) {
      console.log(`  ${r.userName}: extraWorkPoints=${val.toFixed(2)}, points=${r.points?.toFixed(2) ?? 0}`);
    }
  }
  console.log('');

  console.log('--- Сырые данные system_settings extra_work_manual_adjustments ---');
  console.log(manualSetting?.value ?? 'null');

  console.log('\n--- Итог: что увидит пользователь ---');
  console.log('Трое с активной доп. работой:', activeSessions.map((s) => s.user?.name).join(', '));
  for (const r of extraWorkUsers) {
    const neg = (r.extraWorkPoints ?? 0) < 0 ? ' ⚠️ ОТРИЦАТЕЛЬНО — будет отображаться с минусом!' : '';
    console.log(`  ${r.userName}: ${(r.extraWorkPoints ?? 0).toFixed(2)} баллов${neg}`);
  }

  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
