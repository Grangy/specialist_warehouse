/**
 * Генерирует Markdown-отчёт "как считаются баллы доп. работы" для всех пользователей за месяц.
 *
 * Что именно раскрываем:
 * 1) При старте месяца в `extraWorkByUser` кладутся manual adjustments (как в `aggregateRankings`).
 * 2) Затем сессии доп.работы (status=stopped) идут по времени `stoppedAt` и для каждой:
 *    - вычисляются points через `computeExtraWorkPointsForSession(...)`
 *    - `extraWorkByUser[userId]` увеличивается уже на вычисленные points (хронологическая зависимость).
 * 3) Итоговые `extraWorkPoints` = суммы по сессиям + ручные корректировки (manual).
 *
 * Формула "скорости" (внутри computeExtraWorkPointsForSession):
 * - Стартовое окно 09:00–09:15 МСК: фиксированная ставка (points/min).
 * - Иначе: динамическая ставка по темпу склада за последние 15 минут + веса эффективности.
 *
 * Запуск:
 *   npx tsx scripts/audit-extra-work-points-full-breakdown-all-users.ts
 */

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';
import { computeExtraWorkPointsForSession } from '../src/lib/ranking/extraWorkPoints';
import { getManualAdjustmentsMapForPeriod } from '../src/lib/ranking/manualAdjustments';
import { getUsefulnessPctMap } from '../src/lib/ranking/extraWorkPoints';
import { getErrorPenaltiesMapForPeriod } from '../src/lib/ranking/errorPenalties';

function formatDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatHoursFromSec(hsec: number): string {
  const h = hsec / 3600;
  if (h < 0.01) return '0';
  if (h < 1) return `${Math.round(h * 60)} мин`;
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  return mins > 0 ? `${hrs} ч ${mins} мин` : `${hrs} ч`;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  let finalDatabaseUrl = databaseUrl;
  if (databaseUrl?.startsWith('file:./')) {
    const rel = databaseUrl.replace('file:', '');
    finalDatabaseUrl = `file:${path.join(process.cwd(), rel)}`;
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
  });

  const now = new Date();
  const { startDate, endDate } = getStatisticsDateRange('month');
  const monthStart = startDate;
  const monthEnd = endDate;

  // 1) Все пользователи, которые обычно показываются в админке
  const workers = await prisma.user.findMany({
    where: { role: { in: ['collector', 'checker', 'admin'] } },
    select: { id: true, name: true },
  });
  const workerById = new Map<string, string>();
  for (const w of workers) workerById.set(w.id, w.name);

  // 2) Manual adjustments (для seed extraWorkByUser, и для итоговой суммы extraWorkPoints)
  const manualAdjustmentsSetting = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } });
  const manualAdjustmentsMonth = getManualAdjustmentsMapForPeriod(
    manualAdjustmentsSetting?.value ?? null,
    monthStart,
    monthEnd
  );

  // extraWorkByUser в aggregateRankings стартует с ручных корректировок и растёт по мере вычисления сессий
  const extraWorkByUser = new Map<string, number>();
  for (const [uid, delta] of manualAdjustmentsMonth) {
    extraWorkByUser.set(uid, (extraWorkByUser.get(uid) ?? 0) + delta);
  }

  // 3) Сессии доп.работы за месяц (stopped)
  const stoppedSessions = await prisma.extraWorkSession.findMany({
    where: {
      status: 'stopped',
      stoppedAt: { gte: monthStart, lte: monthEnd },
    },
    select: {
      id: true,
      userId: true,
      elapsedSecBeforeLunch: true,
      stoppedAt: true,
      startedAt: true,
    },
  });

  // 4) Хронологический пересчёт extraWorkPoints так же, как в aggregateRankings
  const sortedStoppedMonth = [...stoppedSessions].sort(
    (a, b) => (a.stoppedAt?.getTime() ?? 0) - (b.stoppedAt?.getTime() ?? 0)
  );

  // Вспомогательные структуры для отчёта
  const computedExtraPointsByUser = new Map<string, number>();
  const elapsedSecByUser = new Map<string, number>();
  const sessionDetailsByUser = new Map<
    string,
    Array<{ sessionId: string; startedAt: Date | null; stoppedAt: Date | null; minutes: number; points: number }>
  >();

  for (const sess of sortedStoppedMonth) {
    const pts = await computeExtraWorkPointsForSession(
      prisma as any,
      {
        userId: sess.userId,
        elapsedSecBeforeLunch: sess.elapsedSecBeforeLunch ?? 0,
        stoppedAt: sess.stoppedAt,
        startedAt: sess.startedAt,
      },
      extraWorkByUser
    );

    computedExtraPointsByUser.set(sess.userId, (computedExtraPointsByUser.get(sess.userId) ?? 0) + pts);
    extraWorkByUser.set(sess.userId, (extraWorkByUser.get(sess.userId) ?? 0) + pts);

    elapsedSecByUser.set(sess.userId, (elapsedSecByUser.get(sess.userId) ?? 0) + (sess.elapsedSecBeforeLunch ?? 0));

    const minutes = Math.round(((sess.elapsedSecBeforeLunch ?? 0) / 60) * 10) / 10;
    if (!sessionDetailsByUser.has(sess.userId)) sessionDetailsByUser.set(sess.userId, []);
    sessionDetailsByUser.get(sess.userId)!.push({
      sessionId: sess.id,
      startedAt: sess.startedAt,
      stoppedAt: sess.stoppedAt,
      minutes,
      points: Math.round(pts * 10) / 10,
    });
  }

  // 5) Считаем Польз.% для контекста (использует extraWorkByUser=итоговые extraWorkPoints по месяцу)
  const userIds = workers.map((w) => w.id);
  const errorPenaltiesSetting = await prisma.systemSettings.findUnique({ where: { key: 'error_penalty_adjustments' } });
  const errorPenaltiesMonth = getErrorPenaltiesMapForPeriod(errorPenaltiesSetting?.value ?? null, startDate, endDate);
  const usefulnessPctMap = await getUsefulnessPctMap(prisma as any, userIds, now, extraWorkByUser, errorPenaltiesMonth);

  // 6) Формируем Markdown
  const filenameSafeNow = now.toISOString().slice(0, 10);
  const outPath = path.join(process.cwd(), 'audit-reports', `audit-extra-work-points-full-breakdown-all-users-${filenameSafeNow}.md`);

  const lines: string[] = [];
  lines.push(`# Extra Work Points — полная развертка (все пользователи)`);
  lines.push(``);
  lines.push(`Период: ${formatDate(startDate)} — ${formatDate(endDate)}`);
  lines.push(`Сгенерировано: ${formatDate(now)}`);
  lines.push(``);
  lines.push(`## Термины`);
  lines.push(`- \`Доп.баллы\` / \`extraWorkPoints\` — баллы доп.работы, которые накапливаются по сессиям и добавляются к итогам через \`computeExtraWorkPointsForSession\` и manual adjustments.`);
  lines.push(`- \`extraWorkByUser\` — карта (userId -> extraWorkPoints за месяц), используется для итоговой суммы \`extraWorkPoints\` (ручные корректировки + доп.баллы по сессиям). Веса распределения ставки не зависят от \`extraWorkByUser\` (чтобы убрать self-feedback).`);
  lines.push(``);
  lines.push(`## Пошаговый алгоритм (как считается extraWorkPoints)`);
  lines.push(`1. В начале месяца создаём \`extraWorkByUser\` и заполняем его manual adjustments за месяц.`);
  lines.push(`2. Берём все сессии доп.работы \`status=stopped\` за месяц и сортируем их по \`stoppedAt\` (хронологически).`);
  lines.push(`3. Для каждой сессии \`sess\` вызываем:`);
  lines.push(`   - \`computeExtraWorkPointsForSession(prisma, { userId, elapsedSecBeforeLunch, startedAt, stoppedAt }, extraWorkByUser)\``);
  lines.push(`   - вычисленные points прибавляем в \`extraWorkByUser[userId]\` (для итоговой суммы \`extraWorkPoints\`); распределение темпа зависит только от продуктивности, а не от уже накопленного extra.`);
  lines.push(`4. Итоговые \`extraWorkByUser\` соответствуют \`extraWorkPoints\` из \`aggregateRankings\` (без учёта штрафов за ошибки — штрафы добавляются отдельно в другие поля рейтинга).`);
  lines.push(``);
  lines.push(`## Внутренняя формула ставки (упрощённо, на понимание)`);
  lines.push(`- Если момент времени попадает в окно \`09:00–09:15 МСК\`: ставка фиксированная (\`points/min\`).`);
  lines.push(`- Иначе: ставка зависит от темпа склада за последние 15 минут (\`points/15\`) и распределяется между активными пользователями пропорционально весам эффективности.`);
  lines.push(`- Вес эффективности: \`weight = max(0.3, baseProd(uid) / baseProdTop1)\`, где baseProd(uid) = (pts_month_weekdays / (8 * workingDays_weekdays)) * 0.9.`);
  lines.push(``);
  lines.push(`## Сводка по пользователям`);

  // Таблица summary
  lines.push(`| Пользователь | Сессий | Часы доп. работы | Компьютед extraWorkPoints | Manual delta | Итог extraWorkPoints | Польз.% |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|`);

  for (const w of workers.sort((a, b) => a.name.localeCompare(b.name))) {
    const sessions = sessionDetailsByUser.get(w.id) ?? [];
    const computedPts = computedExtraPointsByUser.get(w.id) ?? 0;
    const manualDelta = manualAdjustmentsMonth.get(w.id) ?? 0;
    const totalPts = extraWorkByUser.get(w.id) ?? manualDelta ?? 0;
    const totalElapsedSec = elapsedSecByUser.get(w.id) ?? 0;

    const usefulnessPct = usefulnessPctMap.get(w.id) ?? null;

    lines.push(
      `| ${w.name} | ${sessions.length} | ${formatHoursFromSec(totalElapsedSec)} | ${Math.round(computedPts * 10) / 10} | ${Math.round(manualDelta * 10) / 10} | ${Math.round(totalPts * 10) / 10} | ${usefulnessPct != null ? usefulnessPct.toFixed(1) + '%' : '—'} |`
    );
  }

  lines.push(``);
  lines.push(`## Детали по пользователям (только где есть сессии или manual delta)`);

  for (const w of workers.sort((a, b) => a.name.localeCompare(b.name))) {
    const sessions = sessionDetailsByUser.get(w.id) ?? [];
    const manualDelta = manualAdjustmentsMonth.get(w.id) ?? 0;
    if (sessions.length === 0 && manualDelta === 0) continue;

    const computedPts = computedExtraPointsByUser.get(w.id) ?? 0;
    const totalPts = extraWorkByUser.get(w.id) ?? manualDelta ?? 0;
    lines.push(``);
    lines.push(`### ${w.name}`);
    lines.push(`- Сессий: ${sessions.length}`);
    lines.push(`- Computed extraWorkPoints: ${Math.round(computedPts * 10) / 10}`);
    lines.push(`- Manual delta: ${Math.round(manualDelta * 10) / 10}`);
    lines.push(`- Итог extraWorkPoints: ${Math.round(totalPts * 10) / 10}`);

    lines.push(``);
    lines.push(`| Сессия | startedAt | stoppedAt | minutes | points |`);
    lines.push(`|---|---|---|---:|---:|`);
    for (const s of sessions.sort((a, b) => (a.stoppedAt?.getTime() ?? 0) - (b.stoppedAt?.getTime() ?? 0))) {
      lines.push(
        `| \`${s.sessionId.slice(0, 6)}\` | ${s.startedAt ? formatDate(s.startedAt) : '—'} | ${
          s.stoppedAt ? formatDate(s.stoppedAt) : '—'
        } | ${s.minutes} | ${s.points} |`
      );
    }
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, lines.join('\n'), 'utf8');

  await prisma.$disconnect();
  // eslint-disable-next-line no-console
  console.log(outPath);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

