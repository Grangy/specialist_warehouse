#!/usr/bin/env npx tsx
/**
 * Аудит доп.работы за календарный день (МСК) по таблице extra_work_sessions.
 *
 * Показывает:
 * - все сессии, которые пересекают сутки (startedAt/stoppedAt по МСК)
 * - рассчитанные баллы (computeExtraWorkPointsForSession)
 * - подозрительные кейсы: status!=stopped, stoppedAt=null, elapsed=0, и т.п.
 *
 * Примеры:
 *   npx tsx --env-file=.env scripts/audit-extra-work-day-msk.ts 2026-04-27
 *   npx tsx --env-file=.env scripts/audit-extra-work-day-msk.ts 2026-04-27 --name "Станислав"
 */

import './loadEnv';

import { prisma } from '../src/lib/prisma';
import { getStatisticsDateRangeForDate } from '../src/lib/utils/moscowDate';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { computeExtraWorkElapsedSecNow, computeStoppedExtraWorkWorkedSec } from '../src/lib/extraWorkElapsed';

const MSK = 3 * 60 * 60 * 1000;

function parseDateArg(): string {
  const fromPos = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : null;
  if (fromPos) return fromPos;
  const i = process.argv.findIndex((a) => a === '--date');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  throw new Error('date is required: YYYY-MM-DD');
}

function parseNameFilter(): string | null {
  const i = process.argv.findIndex((a) => a === '--name');
  if (i !== -1 && process.argv[i + 1]) return String(process.argv[i + 1]);
  return null;
}

function moscowYmd(utc: Date): string {
  const m = new Date(utc.getTime() + MSK);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
  const d = String(m.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

type Row = Awaited<ReturnType<typeof prisma.extraWorkSession.findMany>>[number];

function overlapsMskDay(s: Row, targetYmd: string): boolean {
  const a = moscowYmd(s.startedAt);
  if (!s.stoppedAt) return a === targetYmd;
  const b = moscowYmd(s.stoppedAt);
  if (a === targetYmd || b === targetYmd) return true;
  return a < targetYmd && b > targetYmd;
}

function fmtSec(sec: number): string {
  const h = sec / 3600;
  return `${h.toFixed(2)}h (${Math.round(sec / 60)}m)`;
}

async function main() {
  const dateStr = parseDateArg();
  const nameFilter = parseNameFilter();
  const { startDate, endDate } = getStatisticsDateRangeForDate(dateStr);

  console.log(`\n=== Аудит доп.работы за ${dateStr} (МСК) ===`);
  console.log(`UTC диапазон суток: ${startDate.toISOString()} — ${endDate.toISOString()}`);
  if (nameFilter) console.log(`Фильтр по имени: contains("${nameFilter}")`);
  console.log('');

  const users = await prisma.user.findMany({
    where: nameFilter ? { name: { contains: nameFilter } } : undefined,
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  const ids = new Set(users.map((u) => u.id));
  const idToUser = new Map(users.map((u) => [u.id, u]));

  const sessions = await prisma.extraWorkSession.findMany({
    where: nameFilter ? { userId: { in: [...ids] } } : undefined,
    include: { user: { select: { name: true } }, assignedBy: { select: { name: true } } },
    orderBy: { startedAt: 'asc' },
  });

  const onDay = sessions.filter((s) => overlapsMskDay(s, dateStr));
  console.log(`Сессий, пересекающих сутки: ${onDay.length}`);

  const byUser = new Map<string, Row[]>();
  for (const s of onDay) {
    const list = byUser.get(s.userId) ?? [];
    list.push(s);
    byUser.set(s.userId, list);
  }

  let totalPtsAll = 0;
  const suspicious: Array<{ userName: string; id: string; reason: string }> = [];

  for (const [uid, list] of [...byUser.entries()].sort((a, b) => {
    const an = idToUser.get(a[0])?.name ?? a[1][0]?.user?.name ?? '';
    const bn = idToUser.get(b[0])?.name ?? b[1][0]?.user?.name ?? '';
    return an.localeCompare(bn, 'ru');
  })) {
    const userName = list[0]?.user?.name ?? idToUser.get(uid)?.name ?? uid.slice(0, 8);
    const role = idToUser.get(uid)?.role ?? '—';

    console.log(`\n--- ${userName} (${role}) — ${list.length} сессий ---`);

    let sumPts = 0;
    for (const s of list) {
      const stoppedAt = s.stoppedAt ?? null;
      const elapsedStored = Math.max(0, s.elapsedSecBeforeLunch ?? 0);
      const elapsedTimeline = computeStoppedExtraWorkWorkedSec(s) ?? null;
      const elapsedNowAtDayEnd =
        s.status !== 'stopped' || !stoppedAt
          ? computeExtraWorkElapsedSecNow(
              {
                id: s.id,
                userId: s.userId,
                status: s.status,
                startedAt: s.startedAt,
                elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
                postLunchStartedAt: s.postLunchStartedAt ?? null,
                lunchStartedAt: s.lunchStartedAt ?? null,
              },
              endDate
            )
          : null;

      const calcStop = stoppedAt ?? endDate;
      const pts = await computeExtraWorkPointsForSession(prisma, {
        userId: s.userId,
        elapsedSecBeforeLunch: elapsedStored,
        stoppedAt: calcStop,
        startedAt: s.startedAt,
        lunchStartedAt: s.lunchStartedAt,
        lunchEndsAt: s.lunchEndsAt,
        pointsOverride: s.pointsOverride,
      });
      sumPts += pts;

      const reason: string[] = [];
      if (s.status !== 'stopped') reason.push(`status=${s.status}`);
      if (!s.stoppedAt) reason.push('stoppedAt=—');
      if (elapsedStored <= 0) reason.push('elapsed=0');
      if (elapsedTimeline != null && Math.abs(elapsedTimeline - elapsedStored) > 120) {
        reason.push(`elapsed!=timeline (Δ=${Math.round(elapsedStored - elapsedTimeline)}s)`);
      }

      if (reason.length) suspicious.push({ userName, id: s.id, reason: reason.join(', ') });

      console.log(
        `id=${s.id.slice(0, 8)}… status=${s.status} assignedBy=${s.assignedBy?.name ?? '—'}\n` +
          `  startedAt=${s.startedAt.toISOString()}\n` +
          `  stoppedAt=${s.stoppedAt?.toISOString() ?? '—'}\n` +
          `  elapsed(stored)=${fmtSec(elapsedStored)}\n` +
          `  elapsed(timeline)=${elapsedTimeline == null ? 'n/a' : fmtSec(elapsedTimeline)}\n` +
          `  elapsed(at day end)=${elapsedNowAtDayEnd == null ? 'n/a' : fmtSec(elapsedNowAtDayEnd)}\n` +
          `  pointsOverride=${s.pointsOverride ?? '—'}\n` +
          `  computedPts=${pts.toFixed(1)}`
      );
    }

    console.log(`ИТОГО за сутки (по пересекающимся сессиям): ${sumPts.toFixed(1)} баллов`);
    totalPtsAll += sumPts;
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Users matched: ${users.length}`);
  console.log(`Users with sessions on day: ${byUser.size}`);
  console.log(`Total computed pts (all users, sessions intersecting day): ${totalPtsAll.toFixed(1)}`);

  if (suspicious.length) {
    console.log('\nSuspicious sessions (may not be credited in stats/top):');
    for (const s of suspicious) {
      console.log(`- ${s.userName}: ${s.id} — ${s.reason}`);
    }
  } else {
    console.log('\nNo suspicious sessions detected.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

