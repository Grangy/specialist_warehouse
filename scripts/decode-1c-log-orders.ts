/**
 * Расшифровка заказов из лога 1С: по ID из запроса sync-1c получаем номера и детали из БД.
 * Удобно для разбора «какие заказы 1С присылает с success: false».
 *
 * Запуск:
 *   1) Из строки лога (скопировать одну строку JSON из logs/1c-YYYY-MM-DD.log):
 *      npx tsx scripts/decode-1c-log-orders.ts '{"ts":"...","details":{"ordersSummary":[{"id":"xxx","success":false},...]}}'
 *
 *   2) Из файла лога (берётся последняя запись sync-1c direction=in с ordersSummary):
 *      npx tsx scripts/decode-1c-log-orders.ts --file logs/1c-2026-02-05.log
 *
 *   3) Только ID (через запятую или из файла по одному на строку):
 *      npx tsx scripts/decode-1c-log-orders.ts --ids "id1,id2,id3"
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
let finalDatabaseUrl = databaseUrl;
if (databaseUrl?.startsWith('file:./')) {
  const dbPath = databaseUrl.replace('file:', '');
  finalDatabaseUrl = `file:${path.join(process.cwd(), dbPath)}`;
}

const prisma = new PrismaClient({
  datasources: { db: { url: finalDatabaseUrl || databaseUrl } },
});

function extractIdsFromLogLine(line: string): { ids: string[]; successFalse?: boolean }[] {
  try {
    const o = JSON.parse(line) as { type?: string; direction?: string; details?: { ordersSummary?: Array<{ id?: string; success?: boolean }> } };
    if (o.type !== 'sync-1c' || o.direction !== 'in' || !Array.isArray(o.details?.ordersSummary)) {
      return [];
    }
    return o.details.ordersSummary.map((item) => ({
      ids: item.id ? [item.id] : [],
      successFalse: item.success === false,
    })).filter((x) => x.ids.length > 0);
  } catch {
    return [];
  }
}

function extractAllIdsFromLogLine(line: string): string[] {
  try {
    const o = JSON.parse(line) as { type?: string; direction?: string; details?: { ordersSummary?: Array<{ id?: string; success?: boolean }>; ordersWithSuccessFalseResolved?: unknown[] } };
    if (o.type !== 'sync-1c' || o.direction !== 'in' || !Array.isArray(o.details?.ordersSummary)) {
      return [];
    }
    const ids = o.details.ordersSummary
      .map((item: { id?: string }) => item.id)
      .filter((id): id is string => Boolean(id && String(id).trim()));
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

function extractIdsWithSuccessFalse(line: string): string[] {
  try {
    const o = JSON.parse(line) as { details?: { ordersSummary?: Array<{ id?: string; success?: boolean }> } };
    if (!Array.isArray(o.details?.ordersSummary)) return [];
    return o.details.ordersSummary
      .filter((item) => item.success === false && item.id)
      .map((item) => item.id as string);
  } catch {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2);

  let ids: string[] = [];

  if (args[0] === '--file' && args[1]) {
    const filePath = path.isAbsolute(args[1]) ? args[1] : path.join(process.cwd(), args[1]);
    if (!fs.existsSync(filePath)) {
      console.error('Файл не найден:', filePath);
      process.exit(1);
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').filter((s) => s.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const extracted = extractIdsWithSuccessFalse(line);
      if (extracted.length > 0) {
        ids = extracted;
        console.error('Найдена запись sync-1c (in) с', extracted.length, 'заказами success: false');
        break;
      }
    }
    if (ids.length === 0) {
      console.error('В файле не найдена строка с ordersSummary и success: false');
      process.exit(1);
    }
  } else if (args[0] === '--ids' && args[1]) {
    ids = args[1].split(/[\s,]+/).filter(Boolean);
  } else if (args[0]) {
    const line = args[0];
    if (line.startsWith('{')) {
      ids = extractIdsWithSuccessFalse(line);
      if (ids.length === 0) ids = extractAllIdsFromLogLine(line);
    }
  }

  if (ids.length === 0) {
    console.log('Использование:');
    console.log('  npx tsx scripts/decode-1c-log-orders.ts --file logs/1c-2026-02-05.log');
    console.log('  npx tsx scripts/decode-1c-log-orders.ts --ids "id1,id2,id3"');
    console.log('  npx tsx scripts/decode-1c-log-orders.ts \'{"details":{"ordersSummary":[...]}}\'');
    process.exit(1);
  }

  const shipments = await prisma.shipment.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      number: true,
      customerName: true,
      status: true,
      exportedTo1C: true,
      exportedTo1CAt: true,
      confirmedAt: true,
      deleted: true,
    },
  });

  const byId = new Map(shipments.map((s) => [s.id, s]));
  const notFound = ids.filter((id) => !byId.has(id));

  console.log('\nВсего ID в запросе:', ids.length);
  console.log('Найдено в БД:', shipments.length);
  if (notFound.length > 0) console.log('Не найдено в БД:', notFound.length, '\n');

  console.log('\n№\tНомер заказа\tКлиент\tСтатус\tВыгружен в 1С\tДата выгрузки');
  console.log('—'.repeat(90));
  shipments.forEach((s, i) => {
    console.log(
      [i + 1, s.number, s.customerName, s.status, s.exportedTo1C ? 'да' : 'нет', s.exportedTo1CAt?.toISOString() ?? '—'].join('\t')
    );
  });

  if (notFound.length > 0 && notFound.length <= 20) {
    console.log('\nНе найдены в БД (id):');
    notFound.forEach((id) => console.log('  ', id));
  } else if (notFound.length > 20) {
    console.log('\nНе найдены в БД:', notFound.length, 'записей (первые 5:', notFound.slice(0, 5).join(', '), '...)');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
