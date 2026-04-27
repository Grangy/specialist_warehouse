/**
 * Аудит сессий доп. работы на дату (МСК) для пользователей по подстроке имени
 * + опциональное восстановление elapsed (как в fix-sergey-oleg)
 * + опциональное создание сессий с заданным «рабочим» временем (часы), если сессий за день нет.
 *
 * Примеры:
 *   npx tsx --env-file=.env scripts/audit-extra-work-users-date.ts 2026-04-24
 *   npx tsx --env-file=.env scripts/audit-extra-work-users-date.ts 2026-04-24 --fix-elapsed
 *   npx tsx --env-file=.env scripts/audit-extra-work-users-date.ts 2026-04-24 --create "Албанец=6" "Сергей=5"
 *
 * --create: только для пользователей, у кого в этот календарный день (МСК) нет ни одной сессии.
 * Слот: старт 09:00 МСК, длительность = указанные часы (без обеда в сессии).
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { getStatisticsDateRangeForDate } from '../src/lib/utils/moscowDate';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { computeStoppedExtraWorkWorkedSec } from '../src/lib/extraWorkElapsed';

const MSK = 3 * 60 * 60 * 1000;

function parseDateArg(): string {
  const i = process.argv.findIndex((a) => a === '--date');
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const fromPos = process.argv[2] && /^\d{4}-\d{1,2}-\d{1,2}$/.test(process.argv[2]) ? process.argv[2] : null;
  if (fromPos) return fromPos;
  return '2026-04-24';
}

function moscowYmd(utc: Date): string {
  const m = new Date(utc.getTime() + MSK);
  const y = m.getUTCFullYear();
  const mo = String(m.getUTCMonth() + 1).padStart(2, '0');
  const d = String(m.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

async function main() {
  const dateStr = parseDateArg();
  const { startDate, endDate } = getStatisticsDateRangeForDate(dateStr);
  const applyFix = process.argv.includes('--fix-elapsed');
  /** Сессия завершена по времени, но в БД не stopped — не попадает в месячные доп.баллы */
  const applyStuckStop = process.argv.includes('--fix-stuck-stopped');
  const createArgs = (() => {
    const out: string[] = [];
    let i = 0;
    while (i < process.argv.length) {
      if (process.argv[i] === '--create' && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
        out.push(process.argv[i + 1]);
        i += 2;
        continue;
      }
      i++;
    }
    return out;
  })();
  const applyCreate = createArgs.length > 0;

  const nameHints = ['Албанец', 'Сергей'];
  const users: { id: string; name: string; role: string }[] = [];
  for (const hint of nameHints) {
    const list = await prisma.user.findMany({
      where: { name: { contains: hint } },
      select: { id: true, name: true, role: true },
    });
    for (const u of list) {
      if (!users.some((x) => x.id === u.id)) users.push(u);
    }
  }

  console.log(`\n=== Доп. работа, дата (МСК) ${dateStr} ===`);
  console.log(`UTC диапазон: ${startDate.toISOString()} — ${endDate.toISOString()}\n`);
  if (users.length === 0) {
    console.log('Пользователи по подстрокам «Албанец» / «Сергей» не найдены.');
    return;
  }
  for (const u of users) {
    console.log(`  • ${u.name}  (${u.id.slice(0, 8)}…)  ${u.role}`);
  }
  const ids = users.map((u) => u.id);

  const allUserSessions = await prisma.extraWorkSession.findMany({
    where: { userId: { in: ids } },
    orderBy: { startedAt: 'asc' },
    include: { user: { select: { name: true } }, assignedBy: { select: { name: true } } },
  });

  // Сутки (МСК) targetYmd: сессия «в этот день», если start или stop попадает в день, или день между ними
  const dayKey = (d: Date) => moscowYmd(d);
  const targetYmd = dateStr;
  const onDay = allUserSessions.filter((s) => {
    if (!s.startedAt) return false;
    const a = dayKey(s.startedAt);
    if (!s.stoppedAt) return a === targetYmd;
    const b = dayKey(s.stoppedAt);
    if (a === targetYmd || b === targetYmd) return true;
    return a < targetYmd && b > targetYmd;
  });

  if (onDay.length === 0) {
    console.log(`\nСессий с вхождением в сутки ${dateStr} (по startedAt/stoppedAt) — нет.`);
  } else {
    console.log(`\n--- Сессии за сутки ${dateStr} (всего ${onDay.length}) ---\n`);
  }

  for (const s of onDay) {
    const w = computeStoppedExtraWorkWorkedSec(s);
    const pts = await computeExtraWorkPointsForSession(prisma, {
      userId: s.userId,
      elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
      stoppedAt: s.stoppedAt,
      startedAt: s.startedAt,
      lunchStartedAt: s.lunchStartedAt,
      lunchEndsAt: s.lunchEndsAt,
      pointsOverride: s.pointsOverride,
    });
    console.log(
      `user: ${s.user.name}\n` +
        `  id=${s.id}\n` +
        `  status=${s.status}  assignedBy: ${s.assignedBy.name}\n` +
        `  startedAt: ${s.startedAt.toISOString()}\n` +
        `  stoppedAt: ${s.stoppedAt?.toISOString() ?? '—'}\n` +
        `  lunch: ${s.lunchStartedAt?.toISOString() ?? '—'} — ${s.lunchEndsAt?.toISOString() ?? '—'}\n` +
        `  elapsedSecBeforeLunch: ${(s.elapsedSecBeforeLunch ?? 0).toFixed(1)}  → по таймлайну: ${w ?? 'n/a'}\n` +
        `  баллы (формула): ${pts.toFixed(1)}`
    );
    if (applyStuckStop && s.stoppedAt && s.status !== 'stopped') {
      const w2 = w ?? 0;
      if (!process.argv.includes('--apply-stuck')) {
        console.log(
          `  [fix-stuck] нужно: status=stopped, elapsedSecBeforeLunch=${w2} (сейчас status=${s.status}) — запусти с --apply-stuck`
        );
      } else {
        await prisma.extraWorkSession.update({
          where: { id: s.id },
          data: {
            status: 'stopped',
            elapsedSecBeforeLunch: w2,
            stoppedAt: s.stoppedAt,
          },
        });
        const pts2 = await computeExtraWorkPointsForSession(prisma, {
          userId: s.userId,
          elapsedSecBeforeLunch: w2,
          stoppedAt: s.stoppedAt!,
          startedAt: s.startedAt,
          lunchStartedAt: s.lunchStartedAt,
          lunchEndsAt: s.lunchEndsAt,
          pointsOverride: s.pointsOverride,
        });
        console.log(`  [APPLIED stuck→stopped] баллы: ${pts2.toFixed(1)}`);
      }
    }
    if (s.status === 'stopped' && w != null && w > 0 && applyFix) {
      const cur = s.elapsedSecBeforeLunch ?? 0;
      if (Math.abs(cur - w) > 2) {
        await prisma.extraWorkSession.update({
          where: { id: s.id },
          data: { elapsedSecBeforeLunch: w },
        });
        const pts2 = await computeExtraWorkPointsForSession(prisma, {
          userId: s.userId,
          elapsedSecBeforeLunch: w,
          stoppedAt: s.stoppedAt,
          startedAt: s.startedAt,
          lunchStartedAt: s.lunchStartedAt,
          lunchEndsAt: s.lunchEndsAt,
          pointsOverride: s.pointsOverride,
        });
        console.log(`  [APPLIED] elapsedSecBeforeLunch := ${w}, баллы после: ${pts2.toFixed(1)}`);
      } else {
        console.log('  [fix-elapsed] правка не нужна (уже близко к таймлайну)');
      }
    }
    console.log('');
  }

  if (applyCreate) {
    const admin = await prisma.user.findFirst({ where: { role: 'admin' }, select: { id: true, name: true } });
    if (!admin) {
      console.log('--create: нет пользователя с role=admin');
      return;
    }
    for (const part of createArgs) {
      const m = part.match(/^(.+)=([\d.]+)\s*$/);
      if (!m) {
        console.log(`--create: пропуск неверного формата: ${part} (нужно Имя=часов)`);
        continue;
      }
      const nameSub = m[1].trim();
      const hours = parseFloat(m[2]);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      const user = await prisma.user.findFirst({
        where: { name: { contains: nameSub } },
        select: { id: true, name: true },
      });
      if (!user) {
        console.log(`--create: не найден пользователь по «${nameSub}»`);
        continue;
      }
      const hasThatDay = onDay.some((s) => s.userId === user.id);
      if (hasThatDay) {
        console.log(`--create: у ${user.name} уже есть сессия в этот день — пропуск`);
        continue;
      }
      // 09:00 МСК = 06:00 UTC в этот день
      const dayStartMsk = new Date(startDate);
      const startUtc = new Date(dayStartMsk.getTime() + 9 * 60 * 60 * 1000);
      const workSec = Math.floor(hours * 3600);
      const stopUtc = new Date(startUtc.getTime() + workSec * 1000);
      if (!process.argv.includes('--apply-create')) {
        console.log(
          `[dry-run] создать для ${user.name}: ${hours}ч, start ${startUtc.toISOString()} end ${stopUtc.toISOString()} ` +
            `(добавьте --apply-create для записи в БД)`
        );
        continue;
      }
      const created = await prisma.extraWorkSession.create({
        data: {
          userId: user.id,
          assignedById: admin.id,
          status: 'stopped',
          startedAt: startUtc,
          stoppedAt: stopUtc,
          elapsedSecBeforeLunch: workSec,
          completionType: 'manual',
          comment: 'Восстановление: начислено по заявке (скрипт audit-extra-work-users-date)',
        },
      });
      const p = await computeExtraWorkPointsForSession(prisma, {
        userId: user.id,
        elapsedSecBeforeLunch: workSec,
        stoppedAt: stopUtc,
        startedAt: startUtc,
      });
      console.log(`[created] id=${created.id} ${user.name} ${hours}ч, баллы ~ ${p.toFixed(1)}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
