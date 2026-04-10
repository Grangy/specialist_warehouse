/**
 * Пересчёт elapsedSecBeforeLunch для завершённых сессий доп.работы по таймлайну:
 * (stoppedAt - startedAt) минус пересечение с [lunchStartedAt, lunchEndsAt).
 * Чинит разъехавшееся поле после багов/старых формул (часы в админке ≠ реальная длительность).
 *
 * Запуск (сухой прогон):
 *   npx tsx --env-file=.env scripts/recalc-extra-work-elapsed-from-timeline.ts
 * Применить:
 *   npx tsx --env-file=.env scripts/recalc-extra-work-elapsed-from-timeline.ts --apply
 *
 * Опции:
 *   --days=7        только сессии с stoppedAt не старше N дней (для точечного прогона на проде)
 *   --min-diff=2     минимальная разница (сек) для попадания в отчёт
 *   --max-wall-hours=48   если стена длиннее — обрезать пересчитанные секунды до этого предела (аномалии)
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { computeStoppedExtraWorkWorkedSec } from '../src/lib/extraWorkElapsed';

function argNum(name: string, def: number): number {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return def;
  const v = Number.parseFloat(a.slice(name.length + 1));
  return Number.isFinite(v) ? v : def;
}

function argDays(): number | null {
  const a = process.argv.find((x) => x.startsWith('--days='));
  if (!a) return null;
  const n = Number.parseInt(a.slice('--days='.length), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const minDiff = argNum('--min-diff', 2);
  const maxWallHours = argNum('--max-wall-hours', 48);
  const maxWallSec = Math.max(3600, maxWallHours * 3600);
  const days = argDays();
  const stoppedSince = days != null ? new Date(Date.now() - days * 86400000) : null;

  const stopped = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: stoppedSince ? { not: null, gte: stoppedSince } : { not: null },
    },
    select: {
      id: true,
      userId: true,
      startedAt: true,
      stoppedAt: true,
      lunchStartedAt: true,
      lunchEndsAt: true,
      elapsedSecBeforeLunch: true,
      user: { select: { name: true } },
    },
    orderBy: { stoppedAt: 'desc' },
  });

  const lines: string[] = [];
  let wouldChange = 0;
  let unchanged = 0;

  for (const s of stopped) {
    if (!s.stoppedAt) continue;
    const wallSec = Math.floor((s.stoppedAt.getTime() - s.startedAt.getTime()) / 1000);
    let target = computeStoppedExtraWorkWorkedSec({
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    if (target === null) continue;

    if (wallSec > maxWallSec) {
      target = Math.min(target, maxWallSec);
      lines.push(
        `⚠️ ${s.user.name} session ${s.id.slice(0, 8)}… wall ${(wallSec / 3600).toFixed(1)}h > ${maxWallHours}h → cap`
      );
    }

    const cur = Number(s.elapsedSecBeforeLunch ?? 0);
    // Обед в БД иногда перекрывает всю короткую сессию → формула даёт 0, хотя стена разумная и старое значение ок
    if (target === 0 && wallSec >= 120 && cur >= 60 && cur <= wallSec + 120) {
      target = Math.min(cur, wallSec);
    }

    const diff = Math.abs(cur - target);
    if (diff < minDiff) {
      unchanged++;
      continue;
    }

    wouldChange++;
    lines.push(
      `${s.user.name} | ${s.id.slice(0, 8)}… | было ${cur.toFixed(0)}s (${(cur / 3600).toFixed(2)}h) → будет ${target.toFixed(0)}s (${(target / 3600).toFixed(2)}h) | wall ${(wallSec / 3600).toFixed(2)}h`
    );

    if (apply) {
      await prisma.extraWorkSession.update({
        where: { id: s.id },
        data: { elapsedSecBeforeLunch: target },
      });
    }
  }

  if (stoppedSince) {
    console.log(`Фильтр: stoppedAt >= ${stoppedSince.toISOString()} (--days=${days})\n`);
  }
  console.log(`Завершённых сессий: ${stopped.length}, без изменений (diff < ${minDiff}s): ${unchanged}, к правке: ${wouldChange}\n`);
  console.log(lines.join('\n') || '(нет отличий от таймлайна)');
  if (!apply && wouldChange > 0) {
    console.log(`\nДобавьте --apply чтобы записать ${wouldChange} сессий.`);
  } else if (apply && wouldChange > 0) {
    console.log(`\nЗаписано обновлений: ${wouldChange}.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
