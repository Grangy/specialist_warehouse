/**
 * Аудит: за что Эрнесу 16 баллов доп. работы на этой неделе.
 *
 * Запуск: npx tsx scripts/audit-ernes-extra-work-week.ts
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

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

async function main() {
  console.log('\n=== АУДИТ: доп. работа Эрнеса за неделю ===\n');

  const ernes = await prisma.user.findFirst({ where: { name: { contains: 'Эрнес' } } });
  if (!ernes) {
    console.log('Эрнес не найден');
    await prisma.$disconnect();
    return;
  }

  const { startDate, endDate } = getStatisticsDateRange('week');
  console.log('Период:', startDate.toISOString().slice(0, 10), '—', endDate.toISOString().slice(0, 10));
  console.log('');

  // 1. Сессии доп. работы за неделю
  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      userId: ernes.id,
      status: 'stopped',
      stoppedAt: { gte: startDate, lte: endDate },
    },
    orderBy: { stoppedAt: 'asc' },
  });

  console.log('--- 1. Сессии доп. работы (остановленные за неделю) ---');
  if (sessions.length === 0) {
    console.log('  Нет сессий');
  } else {
    let totalFromSessions = 0;
    for (const s of sessions) {
      const rate = await getExtraWorkRatePerHour(prisma, ernes.id, s.stoppedAt ?? new Date());
      const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
      const pts = calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef);
      totalFromSessions += pts;
      const hours = (s.elapsedSecBeforeLunch ?? 0) / 3600;
      console.log(`  ${s.stoppedAt?.toISOString().slice(0, 10)}: ${hours.toFixed(2)} ч, rate=${rate.toFixed(2)}, coef=${dayCoef.toFixed(2)} → ${pts.toFixed(2)} б.`);
    }
    console.log(`  Итого из сессий: ${totalFromSessions.toFixed(2)} б.`);
  }
  console.log('');

  // 2. Ручные корректировки
  const manualSetting = await prisma.systemSettings.findUnique({
    where: { key: 'extra_work_manual_adjustments' },
  });
  const manualMap = getManualAdjustmentsMapForPeriod(manualSetting?.value ?? null, startDate, endDate);
  const manualErnes = manualMap.get(ernes.id) ?? 0;

  console.log('--- 2. Ручные корректировки за неделю ---');
  console.log('  Эрнес:', manualErnes !== 0 ? `${manualErnes} б.` : '0');
  console.log('  Сырые данные:', manualSetting?.value ?? 'null');
  console.log('');

  // 3. Все пользователи с ручными корректировками (сырой формат)
  if (manualSetting?.value) {
    try {
      const parsed = JSON.parse(manualSetting.value) as Record<string, unknown>;
      console.log('--- 3. Все ручные корректировки (сырой формат) ---');
      for (const [uid, val] of Object.entries(parsed)) {
        const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
        const sum = manualMap.get(uid) ?? 0;
        const isOldFormat = typeof val === 'number';
        console.log(`  ${u?.name ?? uid}: ${JSON.stringify(val)} → за неделю ${sum} б.${isOldFormat ? ' ⚠️ Старый формат (число): дата 1970-01-01, не попадает в период!' : ''}`);
      }
    } catch {
      // ignore
    }
  }
  console.log('');

  // 4. aggregateRankings для проверки
  const { aggregateRankings } = await import('../src/lib/statistics/aggregateRankings');
  const { allRankings } = await aggregateRankings('week');
  const ernesRank = allRankings.find((r) => r.userId === ernes.id);
  console.log('--- 4. aggregateRankings (неделя) ---');
  console.log(`  Эрнес: extraWorkPoints=${ernesRank?.extraWorkPoints?.toFixed(2) ?? 0}, points=${ernesRank?.points?.toFixed(2) ?? 0}`);
  console.log('');

  console.log('--- 5. Причина ---');
  let sessTotal = 0;
  for (const s of sessions) {
    const rate = await getExtraWorkRatePerHour(prisma, ernes.id, s.stoppedAt ?? new Date());
    const dayCoef = await getWeekdayCoefficientForDate(prisma, s.stoppedAt ?? new Date());
    sessTotal += calculateExtraWorkPointsFromRate(s.elapsedSecBeforeLunch ?? 0, rate, dayCoef);
  }
  const total = sessTotal + manualErnes;
  console.log(`  Сессии: ${sessTotal.toFixed(1)} б.`);
  console.log(`  Ручная корректировка: ${manualErnes} б.`);
  console.log(`  Итого: ${total.toFixed(1)} б.`);
  if (Math.abs(manualErnes) >= 0.01 && sessTotal < 1) {
    console.log(`  → Основной источник: ручная корректировка (добавлено через админку)`);
  }
  console.log('\n=== Конец аудита ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
