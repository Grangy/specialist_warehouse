/**
 * Список заказов: активные (new, pending_confirmation) и завершённые (processed, confirmed),
 * созданные до указанной даты и времени по МСК.
 *
 * Запуск: npx tsx scripts/list-orders-created-before-date.ts
 *   По умолчанию: до 28 января 14:00 МСК.
 *
 * Параметры (опционально): npx tsx scripts/list-orders-created-before-date.ts [день] [час] [мин] [месяц]
 *   По умолчанию: 28 14 0 1 — до 28 января 14:00 МСК.
 *   Пример: 28 14 0 2 — до 28 февраля 14:00 МСК.
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

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Порог: до этого момента по МСК (не включая). 14:00 МСК = 11:00 UTC. */
function getCutoffDateMSK(day: number, hour: number, minute: number, month?: number): Date {
  const now = new Date();
  const year = now.getUTCFullYear();
  const m = month ?? 1; // по умолчанию январь
  return new Date(Date.UTC(year, m - 1, day, hour - 3, minute, 0, 0));
}

async function main() {
  const args = process.argv.slice(2);
  const day = args[0] ? parseInt(args[0], 10) : 28;
  const hour = args[1] ? parseInt(args[1], 10) : 14;
  const minute = args[2] ? parseInt(args[2], 10) : 0;
  const monthArg = args[3] ? parseInt(args[3], 10) : undefined;

  const month = monthArg ?? 1;
  const cutoff = getCutoffDateMSK(day, hour, minute, month);
  const cutoffStr = `${day}.${String(month).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} МСК`;

  console.log('\n' + '='.repeat(60));
  console.log('Заказы: активные + завершённые, созданные до', cutoffStr);
  console.log('='.repeat(60));
  console.log('База:', finalDatabaseUrl?.replace(/file:(.*)/, '$1') || process.env.DATABASE_URL);
  console.log('Порог (UTC):', cutoff.toISOString());
  console.log('');

  const shipments = await prisma.shipment.findMany({
    where: {
      deleted: false,
      status: { in: ['new', 'pending_confirmation', 'processed', 'confirmed'] },
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      number: true,
      status: true,
      customerName: true,
      createdAt: true,
      confirmedAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Найдено заказов: ${shipments.length}\n`);

  if (shipments.length === 0) {
    await prisma.$disconnect();
    return;
  }

  const byStatus: Record<string, typeof shipments> = {};
  for (const s of shipments) {
    if (!byStatus[s.status]) byStatus[s.status] = [];
    byStatus[s.status].push(s);
  }
  console.log('По статусам:');
  for (const [status, list] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${list.length}`);
  }
  console.log('');

  console.log('Список заказов:');
  console.log('-'.repeat(80));
  shipments.forEach((s, i) => {
    const created = new Date(s.createdAt.getTime() + MSK_OFFSET_MS);
    const createdStr = `${created.getUTCDate().toString().padStart(2, '0')}.${(created.getUTCMonth() + 1).toString().padStart(2, '0')} ${created.getUTCHours().toString().padStart(2, '0')}:${created.getUTCMinutes().toString().padStart(2, '0')} МСК`;
    const confirmedStr = s.confirmedAt
      ? new Date(s.confirmedAt.getTime() + MSK_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
      : '—';
    console.log(
      `${String(i + 1).padStart(3)}. ${(s.number || '').padEnd(18)} | ${s.status.padEnd(22)} | создан: ${createdStr} | подтверждён: ${confirmedStr}`
    );
  });
  console.log('-'.repeat(80));
  console.log(`Итого: ${shipments.length} заказов\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
