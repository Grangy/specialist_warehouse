/**
 * Восстановить error_penalty_adjustments из бэкапа (как было до полного пересчёта),
 * пересчитать только сегодня (МСК) по текущим правилам.
 *
 * Запуск на проде:
 *   npx tsx scripts/restore-error-penalties-month-keep-today.ts \
 *     --backup=backups/5h/2026-05-19T09-51-36.db \
 *     --backfill-today-admin-login=J-SkaR
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  mergeErrorPenaltiesReplaceDate,
  parseErrorPenaltyAdjustments,
} from '../src/lib/ranking/errorPenalties';
import { buildErrorPenaltyAdjustmentsForRange } from '../src/lib/ranking/buildErrorPenaltyAdjustments';
import { getStatisticsDateRange, getMoscowDateString } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

function parseArg(name: string): string | null {
  const pref = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(pref)) return a.slice(pref.length).trim();
  }
  return null;
}

function loadAdjustmentsFromBackupDb(backupPath: string): Record<string, Array<{ points: number; date: string }>> {
  const abs = path.isAbsolute(backupPath) ? backupPath : path.join(process.cwd(), backupPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Бэкап не найден: ${abs}`);
  }
  const backupPrisma = new PrismaClient({
    datasources: { db: { url: `file:${abs}` } },
  });
  return backupPrisma.systemSettings
    .findUnique({ where: { key: 'error_penalty_adjustments' } })
    .then((row) => parseErrorPenaltyAdjustments(row?.value ?? null))
    .finally(() => backupPrisma.$disconnect());
}

async function backfillTodayAdminRegistrar(login: string, range: { startDate: Date; endDate: Date }) {
  const adminUser = await prisma.user.findFirst({
    where: { login, role: 'admin' },
    select: { id: true, name: true },
  });
  if (!adminUser) {
    throw new Error(`Админ login="${login}" (role=admin) не найден`);
  }
  const updated = await prisma.collectorCall.updateMany({
    where: {
      source: 'admin',
      registeredById: null,
      OR: [
        { confirmedAt: { gte: range.startDate, lte: range.endDate } },
        { confirmedAt: null, calledAt: { gte: range.startDate, lte: range.endDate } },
      ],
    },
    data: { registeredById: adminUser.id },
  });
  console.log(`backfill registeredById: ${login} (${adminUser.name}) — вызовов: ${updated.count}`);
}

async function main() {
  const backupPath = parseArg('backup') ?? 'backups/5h/2026-05-19T09-51-36.db';
  const backfillLogin = parseArg('backfill-today-admin-login') ?? 'J-SkaR';
  const todayRange = getStatisticsDateRange('today');
  const todayStr = getMoscowDateString();

  console.log('\n=== Восстановление штрафов: месяц из бэкапа + только сегодня пересчёт ===\n');
  console.log('Бэкап:', backupPath);
  console.log('Сегодня (МСК):', todayStr, '\n');

  if (backfillLogin) {
    await backfillTodayAdminRegistrar(backfillLogin, todayRange);
  }

  const fromBackup = await loadAdjustmentsFromBackupDb(backupPath);

  // Убрать сегодня из бэкапа на всякий случай (в 09:51 их обычно нет)
  const historical = mergeErrorPenaltiesReplaceDate(fromBackup, {}, todayStr);

  const todayPatch = await buildErrorPenaltyAdjustmentsForRange(prisma, todayRange);
  const merged = mergeErrorPenaltiesReplaceDate(historical, todayPatch, todayStr);

  await prisma.systemSettings.upsert({
    where: { key: 'error_penalty_adjustments' },
    create: { key: 'error_penalty_adjustments', value: JSON.stringify(merged) },
    update: { value: JSON.stringify(merged) },
  });

  let histSum = 0;
  let todaySum = 0;
  for (const list of Object.values(merged)) {
    for (const e of list) {
      if (e.date === todayStr) todaySum += e.points;
      else histSum += e.points;
    }
  }

  console.log(`Записей пользователей: ${Object.keys(merged).length}`);
  console.log(`Сумма по дням ≠ сегодня (из бэкапа): ${histSum.toFixed(2)}`);
  console.log(`Сумма только за ${todayStr}: ${todaySum >= 0 ? '+' : ''}${todaySum.toFixed(2)}`);
  console.log('\n=== Готово ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
