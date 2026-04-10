/**
 * Точечная починка доп.работ (7–8.04.2026): elapsedSecBeforeLunch = факт по таймлайну
 * (стена минус пересечение с обедом), чтобы часы в таблице совпадали с startedAt/stoppedAt
 * и fallback-расчёт баллов не раздувался от битого поля.
 *
 * Сухой прогон:
 *   npx tsx --env-file=.env scripts/fix-extra-work-sessions-april-2026.ts
 * Запись:
 *   npx tsx --env-file=.env scripts/fix-extra-work-sessions-april-2026.ts --apply
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { computeStoppedExtraWorkWorkedSec } from '../src/lib/extraWorkElapsed';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { clearUserStatsCache } from '../src/lib/statistics/getUserStats';

const APPLY = process.argv.includes('--apply');

type Preset = {
  label: string;
  userPart: string;
  warehousePart: string;
  startedAtMs: number;
  stoppedAtMs: number;
};

const TOL_MS = 180_000;

const PRESETS: Preset[] = [
  {
    label: 'Эрнес / Склад 3 / 08.04',
    userPart: 'эрнес',
    warehousePart: 'склад 3',
    startedAtMs: Date.parse('2026-04-08T11:18:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-08T12:40:00+03:00'),
  },
  {
    label: 'Виталий / Приходы / 07.04',
    userPart: 'виталий',
    warehousePart: 'приходы',
    startedAtMs: Date.parse('2026-04-07T11:35:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-07T18:00:00+03:00'),
  },
  {
    label: 'Игорь / Приходы / 07.04',
    userPart: 'игорь',
    warehousePart: 'приходы',
    startedAtMs: Date.parse('2026-04-07T13:22:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-07T18:00:00+03:00'),
  },
];

function matchesPreset(
  s: {
    user: { name: string | null };
    warehouse: string | null;
    startedAt: Date;
    stoppedAt: Date | null;
  },
  p: Preset
): boolean {
  const un = (s.user.name ?? '').toLowerCase();
  const wh = (s.warehouse ?? '').toLowerCase();
  if (!un.includes(p.userPart) || !wh.includes(p.warehousePart)) return false;
  if (!s.stoppedAt) return false;
  if (Math.abs(s.startedAt.getTime() - p.startedAtMs) > TOL_MS) return false;
  if (Math.abs(s.stoppedAt.getTime() - p.stoppedAtMs) > TOL_MS) return false;
  return true;
}

async function main() {
  const candidates = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: {
        gte: new Date('2026-04-07T00:00:00+03:00'),
        lte: new Date('2026-04-09T00:00:00+03:00'),
      },
    },
    include: { user: { select: { name: true } }, assignedBy: { select: { name: true } } },
  });

  for (const p of PRESETS) {
    const found = candidates.filter((s) => matchesPreset(s, p));
    console.log(`\n--- ${p.label} ---`);
    if (found.length === 0) {
      console.log('Не найдено (проверьте БД / имена / время).');
      continue;
    }
    if (found.length > 1) {
      console.log(`Найдено ${found.length} строк — нужна ручная проверка, пропуск.`);
      for (const s of found) {
        console.log(`  id=${s.id} user=${s.user.name} wh=${s.warehouse} ${s.startedAt.toISOString()} → ${s.stoppedAt?.toISOString()}`);
      }
      continue;
    }

    const s = found[0];
    const target = computeStoppedExtraWorkWorkedSec({
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });
    if (target === null) continue;

    const ptsBefore = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
      stoppedAt: s.stoppedAt,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });

    const cur = Number(s.elapsedSecBeforeLunch ?? 0);
    console.log(
      `session=${s.id} user=${s.user.name} assigner=${s.assignedBy.name}\n` +
        `  было elapsedSec=${cur.toFixed(0)} (${(cur / 3600).toFixed(2)} ч), баллы ${ptsBefore.toFixed(1)}\n` +
        `  будет elapsedSec=${target.toFixed(0)} (${(target / 3600).toFixed(2)} ч)`
    );

    if (APPLY) {
      await prisma.extraWorkSession.update({
        where: { id: s.id },
        data: { elapsedSecBeforeLunch: target },
      });
      const ptsAfter = await computeExtraWorkPointsForSession(prisma, {
        userId: s.userId,
        elapsedSecBeforeLunch: target,
        stoppedAt: s.stoppedAt,
        startedAt: s.startedAt,
        lunchStartedAt: s.lunchStartedAt,
        lunchEndsAt: s.lunchEndsAt,
      });
      console.log(`  записано; баллы после правки формулы: ${ptsAfter.toFixed(1)}`);
    }
  }

  if (!APPLY) {
    console.log('\nДобавьте --apply чтобы записать изменения в БД.\n');
  } else {
    clearUserStatsCache();
    console.log('\nКэш детальной статистики пользователей сброшен.\n');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
