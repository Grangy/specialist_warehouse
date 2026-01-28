/**
 * Пометить для выгрузки в 1С все заказы после указанной даты (по МСК).
 * Сбрасывает exportedTo1C = false, exportedTo1CAt = null.
 * Запуск: npx tsx scripts/mark-orders-for-export-by-date.ts [--apply]
 *   Без --apply: dry-run, только показ. С --apply: запись в БД.
 *
 * Дата задаётся в скрипте: AFTER_DATE_MSK (год, месяц 1-12, день).
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;

if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  const absolutePath = path.join(process.cwd(), dbPath);
  finalDatabaseUrl = `file:${absolutePath}`;
}

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: finalDatabaseUrl || databaseUrl,
    },
  },
});

// 14 ноября, 14:10 МСК (UTC+3) → 14 ноября 11:10 UTC
const AFTER_DATE_MSK = { year: 2025, month: 11, day: 14, hour: 14, minute: 10 };
const afterUtc = new Date(Date.UTC(AFTER_DATE_MSK.year, AFTER_DATE_MSK.month - 1, AFTER_DATE_MSK.day, AFTER_DATE_MSK.hour - 3, AFTER_DATE_MSK.minute, 0, 0));

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Пометка заказов к выгрузке в 1С (после даты по МСК)');
  console.log('='.repeat(60));
  console.log(`Дата: после ${AFTER_DATE_MSK.day}.${AFTER_DATE_MSK.month}.${AFTER_DATE_MSK.year} ${String(AFTER_DATE_MSK.hour).padStart(2, '0')}:${String(AFTER_DATE_MSK.minute).padStart(2, '0')} МСК`);
  console.log('Режим:', APPLY ? 'APPLY — будут записаны изменения' : 'DRY-RUN — только показ');
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL);

  const found = await prisma.shipment.findMany({
    where: {
      status: 'processed',
      deleted: false,
      confirmedAt: { gte: afterUtc },
    },
    select: {
      id: true,
      number: true,
      status: true,
      confirmedAt: true,
      exportedTo1C: true,
      exportedTo1CAt: true,
    },
    orderBy: { confirmedAt: 'asc' },
  });

  const toUpdate = found.filter((s) => s.exportedTo1C || s.exportedTo1CAt != null);

  console.log(`\nЗаказов processed после даты: ${found.length}`);
  console.log(`Из них уже помечены как выгруженные (будем сбрасывать в очередь): ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log('\nНет заказов для обновления. Выход.');
    console.log('='.repeat(60) + '\n');
    await prisma.$disconnect();
    return;
  }

  console.log('\nПримеры (первые 20):');
  console.log('-'.repeat(60));
  toUpdate.slice(0, 20).forEach((s, i) => {
    const at = s.confirmedAt ? s.confirmedAt.toISOString().slice(0, 19) : '—';
    console.log(`   ${String(i + 1).padStart(2)}. ${(s.number || '').padEnd(18)} confirmed_at: ${at}`);
  });
  if (toUpdate.length > 20) {
    console.log(`   ... и ещё ${toUpdate.length - 20}`);
  }
  console.log('-'.repeat(60));

  if (APPLY) {
    for (const s of toUpdate) {
      await prisma.shipment.update({
        where: { id: s.id },
        data: { exportedTo1C: false, exportedTo1CAt: null },
      });
    }
    console.log(`\nОбновлено заказов: ${toUpdate.length}. Они попадут в ready-for-export.`);
  } else {
    console.log('\nЧтобы записать изменения, запустите с флагом --apply:');
    console.log('   npx tsx scripts/mark-orders-for-export-by-date.ts --apply');
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main()
  .catch((e) => {
    console.error('Ошибка:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
