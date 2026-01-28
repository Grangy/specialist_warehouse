/**
 * Пометить для выгрузки в 1С заказы, подтверждённые после указанного времени по МСК в каждый день.
 * Сбрасывает exportedTo1C = false, exportedTo1CAt = null.
 * Запуск: npx tsx scripts/mark-orders-for-export-by-date.ts [--apply]
 *   Без --apply: dry-run, только показ. С --apply: запись в БД.
 *
 * В скрипте: AFTER_TIME_MSK (час, минута) — учитываются заказы с confirmed_at >= этого времени МСК в день подтверждения.
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

// Учитывать заказы, подтверждённые в 14:10 МСК и позже (в каждый день)
const AFTER_TIME_MSK = { hour: 14, minute: 10 };
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Время в минутах с полуночи (0..1439). confirmedAt в UTC, возвращаем минуты в МСК. */
function getMinutesMSK(confirmedAt: Date): number {
  const msk = new Date(confirmedAt.getTime() + MSK_OFFSET_MS);
  return msk.getUTCHours() * 60 + msk.getUTCMinutes();
}

function isAfterTimeMSK(confirmedAt: Date): boolean {
  const cutoff = AFTER_TIME_MSK.hour * 60 + AFTER_TIME_MSK.minute;
  return getMinutesMSK(confirmedAt) >= cutoff;
}

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Пометка заказов к выгрузке в 1С (время по МСК)');
  console.log('='.repeat(60));
  console.log(`Условие: confirmed_at >= ${String(AFTER_TIME_MSK.hour).padStart(2, '0')}:${String(AFTER_TIME_MSK.minute).padStart(2, '0')} МСК в день подтверждения`);
  console.log('Режим:', APPLY ? 'APPLY — будут записаны изменения' : 'DRY-RUN — только показ');
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL);

  const allProcessed = await prisma.shipment.findMany({
    where: {
      status: 'processed',
      deleted: false,
      confirmedAt: { not: null },
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

  const found = allProcessed.filter((s) => s.confirmedAt && isAfterTimeMSK(s.confirmedAt));
  const toUpdate = found.filter((s) => s.exportedTo1C || s.exportedTo1CAt != null);

  console.log(`\nЗаказов processed всего: ${allProcessed.length}`);
  console.log(`Из них confirmed_at >= ${String(AFTER_TIME_MSK.hour).padStart(2, '0')}:${String(AFTER_TIME_MSK.minute).padStart(2, '0')} МСК: ${found.length}`);
  console.log(`Из них уже помечены как выгруженные (будем сбрасывать в очередь): ${toUpdate.length}`);

  if (toUpdate.length === 0) {
    console.log('\nНет заказов для обновления. Выход.');
    console.log('='.repeat(60) + '\n');
    await prisma.$disconnect();
    return;
  }

  console.log('\nПримеры (первые 20, время в МСК):');
  console.log('-'.repeat(60));
  toUpdate.slice(0, 20).forEach((s, i) => {
    let mskStr = '—';
    if (s.confirmedAt) {
      const msk = new Date(s.confirmedAt.getTime() + MSK_OFFSET_MS);
      mskStr = `${msk.getUTCFullYear()}-${String(msk.getUTCMonth() + 1).padStart(2, '0')}-${String(msk.getUTCDate()).padStart(2, '0')} ${String(msk.getUTCHours()).padStart(2, '0')}:${String(msk.getUTCMinutes()).padStart(2, '0')} МСК`;
    }
    console.log(`   ${String(i + 1).padStart(2)}. ${(s.number || '').padEnd(18)} confirmed_at: ${mskStr}`);
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
