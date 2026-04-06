/**
 * Аудит доп.работы за сегодня: сверка computeExtraWorkPointsForSession с тем же контрактом,
 * что aggregateRankings / my-session (реальный startedAt + lunch + computeExtraWorkElapsedSecNow для активных).
 *
 * Запуск: npx tsx scripts/audit-extra-work-today-unified.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { computeExtraWorkElapsedSecNow } from '../src/lib/extraWorkElapsed';

async function main() {
  const { startDate, endDate } = getStatisticsDateRange('today');
  const now = new Date();

  const [stoppedToday, active] = await Promise.all([
    prisma.extraWorkSession.findMany({
      where: {
        status: 'stopped',
        stoppedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        stoppedAt: true,
        elapsedSecBeforeLunch: true,
        lunchStartedAt: true,
        lunchEndsAt: true,
      },
    }),
    prisma.extraWorkSession.findMany({
      where: { status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      select: {
        id: true,
        userId: true,
        startedAt: true,
        elapsedSecBeforeLunch: true,
        lunchStartedAt: true,
        lunchEndsAt: true,
        status: true,
        postLunchStartedAt: true,
      },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`Период «сегодня»: ${startDate.toISOString()} … ${endDate.toISOString()}`);
  lines.push(`Завершённых сессий: ${stoppedToday.length}, активных: ${active.length}`);
  lines.push('');

  for (const s of stoppedToday) {
    const pts = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
      stoppedAt: s.stoppedAt,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    lines.push(`stopped ${s.id.slice(0, 8)}… user=${s.userId.slice(0, 8)}… pts=${Math.round(pts * 10) / 10}`);
  }

  for (const s of active) {
    const elapsed = computeExtraWorkElapsedSecNow(s as any, now);
    const pts = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: elapsed,
      stoppedAt: now,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    lines.push(
      `active ${s.id.slice(0, 8)}… user=${s.userId.slice(0, 8)}… status=${s.status} elapsed=${Math.round(elapsed)}s pts=${Math.round(pts * 10) / 10}`
    );
  }

  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
