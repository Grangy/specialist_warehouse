/**
 * Аудит доп. работы за неделю: все пользователи.
 * Показывает сессии, ручные корректировки, итог. Выявляет старый формат (число).
 *
 * Запуск: npx tsx scripts/audit-extra-work-week-all.ts
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { getManualAdjustmentsMapForPeriod } from '../src/lib/ranking/manualAdjustments';
import {
  getExtraWorkRatePerHour,
  calculateExtraWorkPointsFromRate,
} from '../src/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '../src/lib/ranking/weekdayCoefficients';
import { aggregateRankings } from '../src/lib/statistics/aggregateRankings';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== АУДИТ ДОП. РАБОТЫ ЗА НЕДЕЛЮ (все) ===\n');

  const { startDate, endDate } = getStatisticsDateRange('week');
  console.log('Период:', startDate.toISOString().slice(0, 10), '—', endDate.toISOString().slice(0, 10));
  console.log('');

  const manualSetting = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_manual_adjustments' },
  });
  const manualMap = getManualAdjustmentsMapForPeriod(manualSetting?.value ?? null, startDate, endDate);

  // Старый формат: число вместо массива
  let hasOldFormat = false;
  if (manualSetting?.value) {
    try {
      const parsed = JSON.parse(manualSetting.value) as Record<string, unknown>;
      for (const val of Object.values(parsed)) {
        if (typeof val === 'number') {
          hasOldFormat = true;
          break;
        }
      }
    } catch {
      // ignore
    }
  }

  if (hasOldFormat) {
    console.log('⚠️  Обнаружен СТАРЫЙ ФОРМАТ ручных корректировок: число вместо [{points, date}].');
    console.log('   Дата 1970-01-01 не попадает в период → баллы не считаются!');
    console.log('   Запустите: npm run recalc:extra-work-manual');
    console.log('');
  }

  const sessions = await prisma.extraWorkSession.findMany({
    where: { status: 'stopped', stoppedAt: { gte: startDate, lte: endDate } },
    include: { user: { select: { id: true, name: true } } },
  });

  const byUser = new Map<string, { sessions: typeof sessions; pts: number }>();
  for (const s of sessions) {
    if (!byUser.has(s.userId)) {
      byUser.set(s.userId, { sessions: [], pts: 0 });
    }
    const rate = await getExtraWorkRatePerHour(prisma, s.userId, s.stoppedAt ?? new Date());
    const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
    const pts = calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef);
    byUser.get(s.userId)!.sessions.push(s);
    byUser.get(s.userId)!.pts += pts;
  }

  const { allRankings } = await aggregateRankings('week');
  const extraWorkRankings = allRankings.filter((r) => (r.extraWorkPoints ?? 0) > 0);

  console.log('--- Разбивка по пользователям ---');
  const allUserIds = new Set([...byUser.keys(), ...manualMap.keys(), ...extraWorkRankings.map((r) => r.userId)]);
  for (const uid of allUserIds) {
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    const fromSessions = byUser.get(uid)?.pts ?? 0;
    const fromManual = manualMap.get(uid) ?? 0;
    const total = fromSessions + fromManual;
    const fromAgg = extraWorkRankings.find((r) => r.userId === uid)?.extraWorkPoints ?? 0;
    if (total > 0 || fromAgg > 0) {
      const match = Math.abs(total - fromAgg) < 0.1 ? '✓' : '≠';
      console.log(`  ${u?.name ?? uid}: сессии ${fromSessions.toFixed(1)} + ручн. ${fromManual} = ${total.toFixed(1)} б. (aggregate: ${fromAgg.toFixed(1)}) ${match}`);
    }
  }
  console.log('');
  console.log('=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
