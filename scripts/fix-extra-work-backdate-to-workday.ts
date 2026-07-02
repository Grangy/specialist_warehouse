/**
 * Перенос доп.работы на день фактической работы (МСК):
 * сессии, начатые в день D, но не остановленные до 18:00 МСК того же дня,
 * закрываются с stoppedAt = 18:00 МСК дня D и корректным elapsed.
 *
 * npx tsx --env-file=.env scripts/fix-extra-work-backdate-to-workday.ts 2026-06-30
 * npx tsx --env-file=.env scripts/fix-extra-work-backdate-to-workday.ts 2026-06-30 --apply
 */

import './loadEnv';
import { prisma } from '../src/lib/prisma';
import {
  getStatisticsDateRangeForDate,
  getMoscowWorkdayEndUTC,
} from '../src/lib/utils/moscowDate';
import { computeExtraWorkElapsedSecNow } from '../src/lib/extraWorkElapsed';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { clearAggregateSnapshotMemory } from '../src/lib/statistics/statsAggregateCache';
import { clearTopCache } from '../src/lib/statistics/topResponseCache';

const MSK = 3 * 60 * 60 * 1000;

function moscowYmd(utc: Date): string {
  const m = new Date(utc.getTime() + MSK);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
  const d = String(m.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function parseDateArg(): string {
  const a = process.argv[2];
  if (!a || !/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    throw new Error('Укажите дату YYYY-MM-DD, напр. 2026-06-30');
  }
  return a;
}

function elapsedAtWorkdayEnd(
  s: {
    id: string;
    userId: string;
    status: string;
    startedAt: Date;
    elapsedSecBeforeLunch: number | null;
    postLunchStartedAt: Date | null;
    lunchStartedAt: Date | null;
  },
  workdayEnd: Date
): number {
  const base = Math.max(0, s.elapsedSecBeforeLunch ?? 0);
  const simStatus =
    s.status === 'stopped' || s.status === 'lunch'
      ? 'running'
      : s.status;
  const simBase = s.status === 'stopped' ? 0 : base;
  return computeExtraWorkElapsedSecNow(
    {
      id: s.id,
      userId: s.userId,
      status: simStatus,
      startedAt: s.startedAt,
      elapsedSecBeforeLunch: simBase,
      postLunchStartedAt: s.postLunchStartedAt,
      lunchStartedAt: s.lunchStartedAt,
    },
    workdayEnd
  );
}

async function main() {
  const targetYmd = parseDateArg();
  const apply = process.argv.includes('--apply');
  const { startDate, endDate } = getStatisticsDateRangeForDate(targetYmd);
  const workdayEnd = getMoscowWorkdayEndUTC(endDate);

  console.log(`\n=== Перенос доп.работы на ${targetYmd} (МСК) ===`);
  console.log(`Граница рабочего дня: ${workdayEnd.toISOString()} (18:00 МСК)`);
  console.log(apply ? 'РЕЖИМ: --apply\n' : 'РЕЖИМ: dry-run (добавьте --apply)\n');

  const sessions = await prisma.extraWorkSession.findMany({
    where: {
      startedAt: { gte: startDate, lte: endDate },
    },
    include: { user: { select: { name: true } } },
    orderBy: { startedAt: 'asc' },
  });

  const toFix = sessions.filter((s) => {
    if (moscowYmd(s.startedAt) !== targetYmd) return false;
    if (!s.stoppedAt) return true;
    return moscowYmd(s.stoppedAt) !== targetYmd;
  });

  if (toFix.length === 0) {
    console.log('Нет сессий для переноса.');
    return;
  }

  for (const s of toFix) {
    const newElapsed = elapsedAtWorkdayEnd(s, workdayEnd);
    const oldPts =
      s.stoppedAt &&
      (await computeExtraWorkPointsForSession(prisma, {
        userId: s.userId,
        elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
        pointsOverride: s.pointsOverride,
        stoppedAt: s.stoppedAt,
        startedAt: s.startedAt,
        lunchStartedAt: s.lunchStartedAt,
        lunchEndsAt: s.lunchEndsAt,
      }));
    const newPts = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: newElapsed,
      pointsOverride: s.pointsOverride,
      stoppedAt: workdayEnd,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });

    console.log(
      [
        s.user?.name ?? s.userId,
        `status=${s.status}`,
        `start=${s.startedAt.toISOString()}`,
        `oldStop=${s.stoppedAt?.toISOString() ?? '—'}`,
        `oldElapsed=${Math.round((s.elapsedSecBeforeLunch ?? 0) / 60)}m`,
        `→ stop=${workdayEnd.toISOString()}`,
        `newElapsed=${Math.round(newElapsed / 60)}m`,
        `pts ${oldPts != null ? oldPts.toFixed(1) : 'active→today'} → ${newPts.toFixed(1)}`,
        `id=${s.id}`,
      ].join(' | ')
    );

    if (apply) {
      await prisma.extraWorkSession.update({
        where: { id: s.id },
        data: {
          status: 'stopped',
          stoppedAt: workdayEnd,
          elapsedSecBeforeLunch: newElapsed,
        },
      });
    }
  }

  if (apply) {
    clearTopCache();
    clearAggregateSnapshotMemory();
    console.log('\nКэш топа/снимков сброшен. Пересчитайте stats worker или дождитесь прогрева.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
