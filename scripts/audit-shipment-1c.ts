/**
 * Аудит заказа для синхронизации с 1С: состояние в БД, готовность к выгрузке, тест поиска по number+customer.
 *
 * Запуск:
 *   npx tsx scripts/audit-shipment-1c.ts АВУТ-000670
 *   npx tsx scripts/audit-shipment-1c.ts
 * (без аргумента — по умолчанию АВУТ-000670)
 */

import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

async function main() {
  const numberArg = process.argv[2]?.trim() || 'АВУТ-000670';

  console.log('\n' + '='.repeat(70));
  console.log('Аудит заказа для 1С. Аргумент:', JSON.stringify(numberArg));
  console.log('='.repeat(70));

  // 1. Поиск заказа в БД: сначала точное совпадение, затем по окончанию номера (000670 — латинская/кириллическая A)
  let shipment = await prisma.shipment.findUnique({
    where: { number: numberArg },
    include: {
      lines: { orderBy: { sku: 'asc' } },
      tasks: {
        include: {
          lines: { include: { shipmentLine: true } },
        },
      },
    },
  });

  if (!shipment) {
    const bySuffix = await prisma.shipment.findMany({
      where: { number: { endsWith: '000670' } },
      include: {
        lines: { orderBy: { sku: 'asc' } },
        tasks: {
          include: {
            lines: { include: { shipmentLine: true } },
          },
        },
      },
    });
    if (bySuffix.length > 0) {
      shipment = bySuffix[0];
      console.log('\n⚠️ Точного совпадения нет; взят заказ с номером, оканчивающимся на 000670:', shipment.number);
      console.log('   (возможно, в номере латинская A вместо кириллической А или наоборот)');
    }
  }

  if (!shipment) {
    console.log('\n❌ Заказ с номером', numberArg, 'и заказы *000670 не найдены в БД.');
    await prisma.$disconnect();
    process.exit(1);
  }

  const number = shipment.number;

  const allTasksProcessed = shipment.tasks.every((t) => t.status === 'processed');
  const tasksSummary = shipment.tasks.map((t) => ({
    id: t.id,
    warehouse: t.warehouse,
    status: t.status,
  }));

  console.log('\n--- Состояние в БД ---');
  console.log('id:', shipment.id);
  console.log('number:', shipment.number);
  console.log('customerName:', shipment.customerName);
  console.log('status:', shipment.status);
  console.log('deleted:', shipment.deleted);
  console.log('exportedTo1C:', shipment.exportedTo1C);
  console.log('exportedTo1CAt:', shipment.exportedTo1CAt?.toISOString() ?? null);
  console.log('confirmedAt:', shipment.confirmedAt?.toISOString() ?? null);
  console.log('tasks:', shipment.tasks.length, tasksSummary);
  console.log('allTasksProcessed:', allTasksProcessed);

  // 2. Попал бы в ready-for-export?
  const wouldBeReadyForExport =
    shipment.status === 'processed' &&
    !shipment.deleted &&
    shipment.exportedTo1C === false &&
    allTasksProcessed;

  console.log('\n--- Готовность к выгрузке (ready-for-export) ---');
  console.log(
    wouldBeReadyForExport
      ? '✅ Да: заказ попал бы в список готовых к выгрузке (status=processed, exportedTo1C=false, все задания подтверждены)'
      : '❌ Нет:'
  );
  if (!wouldBeReadyForExport) {
    if (shipment.status !== 'processed') console.log('   - status !== processed');
    if (shipment.deleted) console.log('   - deleted');
    if (shipment.exportedTo1C) console.log('   - уже выгружен в 1С (exportedTo1C=true)');
    if (!allTasksProcessed) console.log('   - не все задания в статусе processed');
  }

  // 3. Тест поиска как в sync-1c: по number + customer_name
  const byNumberAndCustomer = await prisma.shipment.findFirst({
    where: {
      number: shipment.number,
      customerName: shipment.customerName,
      deleted: false,
    },
    select: { id: true, number: true, customerName: true, status: true, exportedTo1C: true },
  });

  console.log('\n--- Поиск как в sync-1c (number + customer_name) ---');
  console.log('Запрос: number=', shipment.number, ', customerName=', shipment.customerName);
  if (byNumberAndCustomer) {
    console.log('✅ Найден:', byNumberAndCustomer.id, 'status=', byNumberAndCustomer.status, 'exportedTo1C=', byNumberAndCustomer.exportedTo1C);
    if (byNumberAndCustomer.exportedTo1C) {
      console.log('   → В ответе sync-1c попал бы в errors: { number, customer_name, error: "already_exported" }');
    }
  } else {
    console.log('❌ Не найден (не должно быть для этого же заказа)');
  }

  // 4. POST /api/shipments при попытке создать заказ с тем же номером
  console.log('\n--- POST /api/shipments (создание/перезапись из 1С) ---');
  if (shipment.status === 'processed') {
    console.log('✅ Заказ уже завершён (processed). При POST с тем же number API теперь возвращает:');
    console.log('   success: false, message: "Заказ уже завершён и выгружен в 1С, повторная выгрузка не принимается", skipped: true');
    console.log('   (в консоли сервера: [API POST] Заказ', number, 'пропущен: уже завершён и выгружен в 1С)');
  } else {
    console.log('Заказ не в статусе processed — при POST с тем же number поведение: активный (new/pending) блокируется, удалённый — перезаписывается.');
  }

  // 5. Важно: латинская A vs кириллическая А
  const hasLatinA = /^AВУТ-/.test(shipment.number);
  const hasCyrillicA = /^АВУТ-/.test(shipment.number);
  console.log('\n--- Важно для 1С и POST ---');
  console.log('В БД номер:', JSON.stringify(shipment.number), hasLatinA ? '(латинская A)' : hasCyrillicA ? '(кириллическая А)' : '');
  console.log('Если 1С или импорт пришлёт номер с другой буквой A/А — поиск по number не найдёт заказ и POST создаст дубликат. Нужна единая раскладка (всегда латинская A или всегда кириллическая А).');

  console.log('\n' + '='.repeat(70));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
