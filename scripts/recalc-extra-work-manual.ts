/**
 * Пересчёт ручных корректировок доп. работы.
 * Миграция старого формата (число) в новый ([{points, date}]).
 * Старый формат: {"userId": 20} — дата 1970-01-01, не попадает в период.
 * Новый: {"userId": [{points: 20, date: "2026-03-10"}]} — дата начала недели.
 *
 * Запуск: npx tsx scripts/recalc-extra-work-manual.ts
 *         npx tsx scripts/recalc-extra-work-manual.ts --dry-run  (только показать)
 */

import 'dotenv/config';
import path from 'path';
import { PrismaClient } from '../src/generated/prisma/client';
import { getStatisticsDateRange } from '../src/lib/utils/moscowDate';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  finalDatabaseUrl = `file:${path.join(process.cwd(), databaseUrl.replace('file:', ''))}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl || 'file:./prisma/dev.db' } },
});

const DRY_RUN = process.argv.includes('--dry-run');

type AdjustmentEntry = { points: number; date: string };
type AdjustmentsValue = Record<string, AdjustmentEntry[]>;

async function main() {
  console.log('\n=== ПЕРЕСЧЁТ РУЧНЫХ КОРРЕКТИРОВОК ДОП. РАБОТЫ ===\n');
  if (DRY_RUN) console.log('(режим --dry-run, изменения не применяются)\n');

  const { startDate } = getStatisticsDateRange('week');
  // Дата начала недели по Москве (для применения корректировки в текущей неделе)
  const mskDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000);
  const weekStartStr = mskDate.toISOString().slice(0, 10);

  const s = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } });
  const raw = s?.value;
  if (!raw) {
    console.log('Нет ручных корректировок.');
    await prisma.$disconnect();
    return;
  }

  let adj: AdjustmentsValue = {};
  let migrated = false;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [uid, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) {
        adj[uid] = (val as unknown[]).filter(
          (e): e is AdjustmentEntry =>
            e != null && typeof e === 'object' && 'points' in e && 'date' in e && typeof (e as AdjustmentEntry).date === 'string'
        ) as AdjustmentEntry[];
      } else if (typeof val === 'number') {
        adj[uid] = [{ points: val, date: weekStartStr }];
        migrated = true;
        const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
        console.log(`  Миграция: ${u?.name ?? uid}: ${val} → [{points: ${val}, date: "${weekStartStr}"}]`);
      }
    }
  } catch (e) {
    console.error('Ошибка парсинга:', e);
    await prisma.$disconnect();
    return;
  }

  if (!migrated) {
    console.log('Миграция не требуется (формат уже новый).');
    await prisma.$disconnect();
    return;
  }

  if (!DRY_RUN) {
    await prisma.systemSettings.upsert({
      where: { key: 'extra_work_manual_adjustments' },
      update: { value: JSON.stringify(adj) },
      create: { key: 'extra_work_manual_adjustments', value: JSON.stringify(adj) },
    });
    console.log('\n✅ Миграция применена.');
  } else {
    console.log('\n(режим dry-run: изменения не сохранены)');
  }

  console.log('\n=== Готово ===\n');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
