/**
 * Аудит данных выгрузки в 1С: полный payload заказа и сравнение с другим заказом.
 * Помогает выяснить, чем заказ, не помечающийся в 1С как «принят со склада», отличается от успешного.
 *
 * Запуск:
 *   npx tsx scripts/audit-export-payload.ts 1642
 *   npx tsx scripts/audit-export-payload.ts 1642 1639
 *   npx tsx scripts/audit-export-payload.ts 1642 --compare 1600
 *
 * Вывод: полный JSON payload (как в GET ready-for-export), сводка по полям (null/пусто),
 * и при двух заказах — построчное сравнение отличий.
 */

import { PrismaClient } from '../src/generated/prisma/client';
import path from 'path';
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

function areAllTasksConfirmed(tasks: Array<{ status: string }>): boolean {
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === 'processed');
}

type TaskLine = {
  confirmedQty: number | null;
  collectedQty: number | null;
  qty: number;
  shipmentLineId: string;
};
type Line = {
  id: string;
  sku: string;
  art: string | null;
  name: string;
  qty: number;
  collectedQty: number | null;
  confirmedQty: number | null;
  uom: string;
  location: string | null;
  warehouse: string | null;
  checked: boolean;
};
type Task = {
  id: string;
  warehouse: string;
  status: string;
  collectorName: string | null;
  lines: Array<TaskLine & { shipmentLine: Line }>;
};

function buildExportPayload(shipment: {
  id: string;
  number: string;
  customerName: string;
  destination: string;
  status: string;
  businessRegion: string | null;
  comment: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  weight: number | null;
  places: number | null;
  lines: Line[];
  tasks: Task[];
}) {
  const confirmedQtyByLine: Record<string, number> = {};
  for (const task of shipment.tasks) {
    for (const taskLine of task.lines) {
      const qty = taskLine.confirmedQty !== null ? taskLine.confirmedQty : taskLine.collectedQty;
      if (qty !== null && qty !== undefined) {
        const lineId = taskLine.shipmentLineId;
        confirmedQtyByLine[lineId] = (confirmedQtyByLine[lineId] ?? 0) + qty;
      }
    }
  }

  return {
    id: shipment.id,
    number: shipment.number,
    customer_name: shipment.customerName,
    destination: shipment.destination,
    status: shipment.status,
    business_region: shipment.businessRegion,
    comment: shipment.comment || '',
    places: shipment.places ?? null,
    created_at: shipment.createdAt.toISOString(),
    confirmed_at: shipment.confirmedAt?.toISOString() ?? null,
    processed_at: shipment.confirmedAt?.toISOString() ?? new Date().toISOString(),
    tasks_count: shipment.tasks.length,
    items_count: shipment.lines.length,
    total_qty: shipment.lines.reduce((sum, line) => {
      const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
      return sum + confirmedQty;
    }, 0),
    weight: shipment.weight,
    lines: shipment.lines.map((line) => {
      const confirmedQty = confirmedQtyByLine[line.id] ?? line.collectedQty ?? line.qty;
      return {
        sku: line.sku,
        art: line.art ?? null,
        name: line.name,
        qty: confirmedQty,
        collected_qty: confirmedQty,
        uom: line.uom,
        location: line.location,
        warehouse: line.warehouse,
        checked: line.checked,
      };
    }),
    tasks: shipment.tasks.map((t) => ({
      id: t.id,
      warehouse: t.warehouse,
      status: t.status,
      collector_name: t.collectorName,
      items_count: t.lines.length,
      total_qty: t.lines.reduce((sum, line) => {
        const qty = line.confirmedQty !== null ? line.confirmedQty : (line.collectedQty || line.qty);
        return sum + qty;
      }, 0),
    })),
  };
}

function summaryPayload(payload: ReturnType<typeof buildExportPayload>) {
  const issues: string[] = [];
  if (payload.destination === '' || payload.destination == null) issues.push('destination пустой');
  if (payload.confirmed_at == null) issues.push('confirmed_at отсутствует');
  if (payload.weight == null) issues.push('weight отсутствует');
  if (payload.places == null) issues.push('places отсутствует');
  if (payload.business_region == null || payload.business_region === '') issues.push('business_region пустой');
  const linesNoArt = payload.lines.filter((l) => l.art == null || l.art === '');
  if (linesNoArt.length > 0) issues.push(`строк без art: ${linesNoArt.length}/${payload.lines.length}`);
  const linesNoLocation = payload.lines.filter((l) => l.location == null || l.location === '');
  if (linesNoLocation.length > 0) issues.push(`строк без location: ${linesNoLocation.length}/${payload.lines.length}`);
  return { issues, linesNoArt: linesNoArt.length, linesNoLocation: linesNoLocation.length };
}

function diffPayloads(
  a: ReturnType<typeof buildExportPayload>,
  b: ReturnType<typeof buildExportPayload>
) {
  const topKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const headerDiff: string[] = [];
  for (const k of topKeys) {
    if (k === 'lines' || k === 'tasks') continue;
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      headerDiff.push(`${k}: ${JSON.stringify(va)} !== ${JSON.stringify(vb)}`);
    }
  }
  const lineDiffs: string[] = [];
  const maxLines = Math.max(a.lines.length, b.lines.length);
  for (let i = 0; i < maxLines; i++) {
    const la = a.lines[i];
    const lb = b.lines[i];
    if (!la || !lb) {
      lineDiffs.push(`Строка ${i}: только в одном заказе (A: ${la?.sku ?? '—'}, B: ${lb?.sku ?? '—'})`);
      continue;
    }
    const keys = new Set([...Object.keys(la), ...Object.keys(lb)]) as Set<keyof typeof la>;
    for (const k of keys) {
      const va = la[k];
      const vb = lb[k];
      if (JSON.stringify(va) !== JSON.stringify(vb)) {
        lineDiffs.push(`Строка ${i} (${la.sku}): ${String(k)} = ${JSON.stringify(va)} vs ${JSON.stringify(vb)}`);
      }
    }
  }
  return { headerDiff, lineDiffs };
}

async function main() {
  const args = process.argv.slice(2);
  let compareNum: string | null = null;
  const numArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--compare' && args[i + 1]) {
      compareNum = args[i + 1];
      i++;
      continue;
    }
    numArgs.push(args[i]);
  }

  const numbers = numArgs.length > 0 ? numArgs : ['1642', '1639'];
  if (compareNum) numbers.push(compareNum);

  const shipments: Array<{ number: string; payload: ReturnType<typeof buildExportPayload>; raw: unknown }> = [];

  for (const q of numbers) {
    const shipment = await prisma.shipment.findFirst({
      where: {
        deleted: false,
        OR: [
          { number: { contains: q } },
          { number: { contains: `ИПУТ-${q.padStart(6, '0')}` } },
        ],
      },
      include: {
        lines: { orderBy: { sku: 'asc' } },
        tasks: {
          include: {
            lines: {
              include: { shipmentLine: true },
            },
          },
        },
      },
    });

    if (!shipment) {
      console.log(`Заказ не найден: ${q}`);
      continue;
    }

    if (!areAllTasksConfirmed(shipment.tasks.map((t) => ({ status: t.status })))) {
      console.log(`Заказ ${shipment.number}: не все задания в статусе processed, payload может не совпадать с ready-for-export.`);
    }

    const payload = buildExportPayload(shipment);
    const summary = summaryPayload(payload);
    shipments.push({ number: shipment.number, payload, raw: shipment });

    console.log('\n' + '='.repeat(70));
    console.log(`ЗАКАЗ ${shipment.number} (id=${shipment.id})`);
    console.log('='.repeat(70));
    console.log('Сводка по полям:', summary.issues.length ? summary.issues.join('; ') : 'критичных отличий нет');
    console.log('Строк без art:', summary.linesNoArt, '/', payload.lines.length);
    console.log('Строк без location:', summary.linesNoLocation, '/', payload.lines.length);
    console.log('\nПолный payload (как уходит в 1С):');
    console.log(JSON.stringify(payload, null, 2));
  }

  if (shipments.length >= 2) {
    console.log('\n' + '='.repeat(70));
    console.log('СРАВНЕНИЕ ПЕРВОГО И ВТОРОГО ЗАКАЗА');
    console.log('='.repeat(70));
    const { headerDiff, lineDiffs } = diffPayloads(shipments[0].payload, shipments[1].payload);
    console.log('Отличия в заголовке (id/number/customer и т.д.):');
    if (headerDiff.length === 0) console.log('  нет');
    else headerDiff.forEach((d) => console.log('  ', d));
    console.log('\nОтличия по строкам (sku, art, qty, location...):');
    if (lineDiffs.length === 0) console.log('  нет');
    else lineDiffs.slice(0, 30).forEach((d) => console.log('  ', d));
    if (lineDiffs.length > 30) console.log('  ... и ещё', lineDiffs.length - 30);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
