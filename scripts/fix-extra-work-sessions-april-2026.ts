/**
 * Точечная починка доп.работ (7–8.04.2026):
 * - elapsedSecBeforeLunch = факт по таймлайну;
 * - при --rate=N: pointsOverride = отработанные часы × N (фикс баллов вместо формулы).
 *
 * Сопоставление: имя работника + Дмитрий у назначившего + время старт/стоп (без привязки к полю
 * warehouse — в админке «Приходы» часто в комментарии, склад в строке может быть «Склад 1»).
 *
 *   npx tsx --env-file=.env scripts/fix-extra-work-sessions-april-2026.ts --list
 *   npx tsx --env-file=.env scripts/fix-extra-work-sessions-april-2026.ts --apply --rate=65
 *
 * На проде:
 *   bash -lc 'cd /var/www/specialist_warehouse && . /root/.nvm/nvm.sh && npx tsx --env-file=.env scripts/fix-extra-work-sessions-april-2026.ts --apply --rate=65'
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { computeStoppedExtraWorkWorkedSec } from '../src/lib/extraWorkElapsed';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { clearUserStatsCache } from '../src/lib/statistics/getUserStats';

const APPLY = process.argv.includes('--apply');
const LIST = process.argv.includes('--list');
const CLEAR_OVERRIDE = process.argv.includes('--clear-override');

function argRate(): number | null {
  const a = process.argv.find((x) => x.startsWith('--rate='));
  if (!a) return null;
  const n = Number.parseFloat(a.slice('--rate='.length));
  return Number.isFinite(n) && n > 0 ? n : null;
}

const RATE_PER_HOUR = argRate();

/** Допуск по времени (сервер мог сохранить с секундами / рассинхрон UI) */
const TOL_MS = 600_000;

type Preset = {
  label: string;
  /** Любая подстрока в нижнем регистре совпала с ФИО */
  userNameSubstrings: string[];
  startedAtMs: number;
  stoppedAtMs: number;
};

const PRESETS: Preset[] = [
  {
    label: 'Эрнес / 08.04',
    userNameSubstrings: ['эрнес', 'ernes'],
    startedAtMs: Date.parse('2026-04-08T11:18:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-08T12:40:00+03:00'),
  },
  {
    label: 'Виталий / 07.04',
    userNameSubstrings: ['виталий', 'vitaliy', 'витал'],
    startedAtMs: Date.parse('2026-04-07T11:35:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-07T18:00:00+03:00'),
  },
  {
    label: 'Игорь / 07.04',
    userNameSubstrings: ['игорь', 'igor'],
    startedAtMs: Date.parse('2026-04-07T13:22:00+03:00'),
    stoppedAtMs: Date.parse('2026-04-07T18:00:00+03:00'),
  },
];

function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .trim();
}

function userMatches(name: string | null, subs: string[]): boolean {
  const n = norm(name);
  return subs.some((sub) => n.includes(sub));
}

function assignerIsDmitry(assignerName: string | null): boolean {
  const a = norm(assignerName);
  return a.includes('дмитрий') || a.includes('палыч');
}

function matchesTimeAndUser(
  s: {
    user: { name: string | null };
    startedAt: Date;
    stoppedAt: Date | null;
  },
  p: Preset
): boolean {
  if (!userMatches(s.user.name, p.userNameSubstrings)) return false;
  if (!s.stoppedAt) return false;
  if (Math.abs(s.startedAt.getTime() - p.startedAtMs) > TOL_MS) return false;
  if (Math.abs(s.stoppedAt.getTime() - p.stoppedAtMs) > TOL_MS) return false;
  return true;
}

/** Если несколько строк с одним воркером и временем — берём с Дмитрием/Палычом */
function pickSessionsForPreset(
  candidates: Array<{
    user: { name: string | null };
    assignedBy: { name: string | null };
    startedAt: Date;
    stoppedAt: Date | null;
  }>,
  p: Preset
): typeof candidates {
  const byTime = candidates.filter((s) => matchesTimeAndUser(s, p));
  if (byTime.length === 0) return [];
  if (byTime.length === 1) return byTime;
  const withDmitry = byTime.filter((s) => assignerIsDmitry(s.assignedBy.name));
  if (withDmitry.length === 1) return withDmitry;
  return byTime;
}

async function main() {
  if (CLEAR_OVERRIDE && RATE_PER_HOUR != null) {
    console.error('Нельзя одновременно --clear-override и --rate=');
    process.exit(1);
  }

  const candidates = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: {
        gte: new Date('2026-04-06T12:00:00.000Z'),
        lte: new Date('2026-04-09T12:00:00.000Z'),
      },
    },
    include: { user: { select: { name: true } }, assignedBy: { select: { name: true } } },
  });

  if (LIST) {
    console.log(`Остановленные сессии в окне (всего ${candidates.length}):\n`);
    for (const s of candidates.sort((a, b) => (a.stoppedAt?.getTime() ?? 0) - (b.stoppedAt?.getTime() ?? 0))) {
      const w = computeStoppedExtraWorkWorkedSec({
        startedAt: s.startedAt,
        stoppedAt: s.stoppedAt,
        lunchStartedAt: s.lunchStartedAt,
        lunchEndsAt: s.lunchEndsAt,
      });
      const wh = w ?? 0;
      console.log(
        `${s.id} | ${s.user.name} | от ${s.assignedBy.name} | wh=${s.warehouse ?? '—'} | ${s.startedAt.toISOString()} → ${s.stoppedAt?.toISOString()} | ` +
          `elapsed=${Number(s.elapsedSecBeforeLunch ?? 0).toFixed(0)}s work~${(wh / 3600).toFixed(2)}h | override=${s.pointsOverride ?? '—'}`
      );
    }
    console.log('');
  }

  for (const p of PRESETS) {
    const found = pickSessionsForPreset(candidates, p);
    console.log(`\n--- ${p.label} ---`);
    if (found.length === 0) {
      console.log('Не найдено (см. --list: имя / кто назначил / время в пределах 10 мин).');
      continue;
    }
    if (found.length > 1) {
      console.log(`Найдено ${found.length} строк — пропуск (уточните пресет).`);
      for (const s of found) {
        console.log(
          `  id=${s.id} user=${s.user.name} wh=${s.warehouse} ${s.startedAt.toISOString()} → ${s.stoppedAt?.toISOString()}`
        );
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

    const workedHours = target / 3600;
    const overridePts =
      RATE_PER_HOUR != null ? Math.round(workedHours * RATE_PER_HOUR * 10) / 10 : null;

    const ptsBefore = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
      pointsOverride: s.pointsOverride,
      stoppedAt: s.stoppedAt,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
    });

    const cur = Number(s.elapsedSecBeforeLunch ?? 0);
    const curOv = s.pointsOverride != null ? Number(s.pointsOverride) : null;
    console.log(
      `session=${s.id} user=${s.user.name} assigner=${s.assignedBy.name} wh=${s.warehouse ?? '—'}\n` +
        `  было elapsedSec=${cur.toFixed(0)} (${(cur / 3600).toFixed(2)} ч), override=${curOv ?? '—'}, баллы ${ptsBefore.toFixed(1)}\n` +
        `  будет elapsedSec=${target.toFixed(0)} (${workedHours.toFixed(2)} ч)` +
        (overridePts != null ? `, override=${overridePts} (${RATE_PER_HOUR} б/ч)` : '')
    );

    if (APPLY) {
      if (CLEAR_OVERRIDE) {
        await prisma.extraWorkSession.update({
          where: { id: s.id },
          data: { elapsedSecBeforeLunch: target, pointsOverride: null },
        });
        const ptsAfterClear = await computeExtraWorkPointsForSession(prisma, {
          userId: s.userId,
          elapsedSecBeforeLunch: target,
          pointsOverride: null,
          stoppedAt: s.stoppedAt,
          startedAt: s.startedAt,
          lunchStartedAt: s.lunchStartedAt,
          lunchEndsAt: s.lunchEndsAt,
        });
        console.log(`  записано (override сброшен); баллы по формуле: ${ptsAfterClear.toFixed(1)}`);
      } else {
        await prisma.extraWorkSession.update({
          where: { id: s.id },
          data: {
            elapsedSecBeforeLunch: target,
            ...(overridePts != null ? { pointsOverride: overridePts } : {}),
          },
        });
        const ptsAfter = await computeExtraWorkPointsForSession(prisma, {
          userId: s.userId,
          elapsedSecBeforeLunch: target,
          pointsOverride: overridePts ?? s.pointsOverride,
          stoppedAt: s.stoppedAt,
          startedAt: s.startedAt,
          lunchStartedAt: s.lunchStartedAt,
          lunchEndsAt: s.lunchEndsAt,
        });
        console.log(`  записано; итоговые баллы: ${ptsAfter.toFixed(1)}`);
      }
    }
  }

  if (!APPLY && !LIST) {
    console.log('\nДобавьте --apply --rate=65 или сначала --list.\n');
  } else if (APPLY) {
    clearUserStatsCache();
    console.log(
      '\nКэш user stats сброшен. На проде после правки выполните пересчёт снапшотов:\n' +
        '  npx tsx --env-file=.env scripts/recalculate-extra-work-new-formula-all.ts --clear-file-cache\n'
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
