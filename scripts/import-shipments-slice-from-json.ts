#!/usr/bin/env npx tsx
import './loadEnv';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/prisma';

type AnyRow = Record<string, any>;

function readJsonArray(filePath: string): AnyRow[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  const data = JSON.parse(raw) as unknown;
  return Array.isArray(data) ? (data as AnyRow[]) : [];
}

function msToDateOrNull(ms: any): Date | null {
  if (ms == null) return null;
  const n = typeof ms === 'number' ? ms : Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n);
}

function msToDateOrUndef(ms: any): Date | undefined {
  const d = msToDateOrNull(ms);
  return d ?? undefined;
}

function mapShipment(r: AnyRow) {
  return {
    id: String(r.id),
    number: String(r.number),
    createdAt: msToDateOrUndef(r.created_at),
    customerName: String(r.customer_name ?? ''),
    destination: String(r.destination ?? ''),
    itemsCount: Number(r.items_count ?? 0),
    totalQty: Number(r.total_qty ?? 0),
    weight: r.weight == null ? null : Number(r.weight),
    comment: String(r.comment ?? ''),
    status: String(r.status ?? 'new'),
    businessRegion: r.business_region == null ? null : String(r.business_region),
    collectorName: r.collector_name == null ? null : String(r.collector_name),
    confirmedAt: msToDateOrNull(r.confirmed_at),
    exportedTo1C: Boolean(r.exported_to_1c),
    exportedTo1CAt: msToDateOrNull(r.exported_to_1c_at),
    places: r.places == null ? null : Number(r.places),
    deleted: Boolean(r.deleted),
    deletedAt: msToDateOrNull(r.deleted_at),
    pinnedAt: msToDateOrNull(r.pinned_at),
    lastSentTo1CAt: msToDateOrNull(r.last_sent_to_1c_at),
    excludedFrom1C: Boolean(r.excluded_from_1c),
  } as const;
}

function mapShipmentLine(r: AnyRow) {
  return {
    id: String(r.id),
    shipmentId: String(r.shipment_id),
    sku: String(r.sku ?? ''),
    art: r.art == null ? null : String(r.art),
    name: String(r.name ?? ''),
    qty: Number(r.qty ?? 0),
    uom: String(r.uom ?? ''),
    location: r.location == null ? null : String(r.location),
    warehouse: r.warehouse == null ? null : String(r.warehouse),
    collectedQty: r.collected_qty == null ? null : Number(r.collected_qty),
    checked: Boolean(r.checked),
    confirmedQty: r.confirmed_qty == null ? null : Number(r.confirmed_qty),
    confirmed: Boolean(r.confirmed),
  } as const;
}

function mapShipmentTask(r: AnyRow) {
  return {
    id: String(r.id),
    shipmentId: String(r.shipment_id),
    warehouse: String(r.warehouse ?? ''),
    status: String(r.status ?? 'new'),
    createdAt: msToDateOrUndef(r.created_at),
    collectorName: r.collector_name == null ? null : String(r.collector_name),
    collectorId: r.collector_id == null ? null : String(r.collector_id),
    startedAt: msToDateOrNull(r.started_at),
    completedAt: msToDateOrNull(r.completed_at),
    checkerName: r.checker_name == null ? null : String(r.checker_name),
    checkerId: r.checker_id == null ? null : String(r.checker_id),
    dictatorId: r.dictator_id == null ? null : String(r.dictator_id),
    confirmedAt: msToDateOrNull(r.confirmed_at),
    totalItems: r.total_items == null ? null : Number(r.total_items),
    totalUnits: r.total_units == null ? null : Number(r.total_units),
    timePer100Items: r.time_per_100_items == null ? null : Number(r.time_per_100_items),
    places: r.places == null ? null : Number(r.places),
    checkerStartedAt: msToDateOrNull(r.checker_started_at),
    updatedAt: msToDateOrNull(r.updated_at),
    droppedByCollectorId: r.dropped_by_collector_id == null ? null : String(r.dropped_by_collector_id),
    droppedByCollectorName: r.dropped_by_collector_name == null ? null : String(r.dropped_by_collector_name),
    droppedAt: msToDateOrNull(r.dropped_at),
  } as const;
}

function mapShipmentTaskLine(r: AnyRow) {
  return {
    id: String(r.id),
    taskId: String(r.task_id),
    shipmentLineId: String(r.shipment_line_id),
    qty: Number(r.qty ?? 0),
    collectedQty: r.collected_qty == null ? null : Number(r.collected_qty),
    checked: Boolean(r.checked),
    confirmedQty: r.confirmed_qty == null ? null : Number(r.confirmed_qty),
    confirmed: Boolean(r.confirmed),
  } as const;
}

async function upsertAll<T extends { id: string }>(
  label: string,
  rows: T[],
  upsert: (r: T) => Promise<any>
): Promise<void> {
  if (!rows.length) {
    console.log(`[import] ${label}: 0`);
    return;
  }
  console.log(`[import] ${label}: ${rows.length}...`);
  let ok = 0;
  for (const r of rows) {
    await upsert(r);
    ok += 1;
    if (ok % 50 === 0) console.log(`[import] ${label}: ${ok}/${rows.length}`);
  }
  console.log(`[import] ${label}: done (${ok})`);
}

async function main() {
  const dirIdx = process.argv.findIndex((a) => a === '--dir');
  const dir = dirIdx >= 0 && process.argv[dirIdx + 1] ? process.argv[dirIdx + 1] : '';
  if (!dir) {
    console.error('Usage: npx tsx scripts/import-shipments-slice-from-json.ts --dir <DIR_WITH_JSON>');
    process.exit(2);
  }
  const absDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);

  const shipments = readJsonArray(path.join(absDir, 'shipments.json')).map(mapShipment);
  const lines = readJsonArray(path.join(absDir, 'shipment_lines.json')).map(mapShipmentLine);
  const tasks = readJsonArray(path.join(absDir, 'shipment_tasks.json')).map(mapShipmentTask);
  const taskLines = readJsonArray(path.join(absDir, 'shipment_task_lines.json')).map(mapShipmentTaskLine);

  console.log('[import] dir:', absDir);
  console.log('[import] shipments:', shipments.length);
  console.log('[import] shipment_lines:', lines.length);
  console.log('[import] shipment_tasks:', tasks.length);
  console.log('[import] shipment_task_lines:', taskLines.length);

  await upsertAll('shipments', shipments, async (r) => {
    const { id, ...data } = r;
    return prisma.shipment.upsert({ where: { id }, create: r as any, update: data as any });
  });
  await upsertAll('shipment_lines', lines, async (r) => {
    const { id, ...data } = r;
    return prisma.shipmentLine.upsert({ where: { id }, create: r as any, update: data as any });
  });
  await upsertAll('shipment_tasks', tasks, async (r) => {
    const { id, ...data } = r;
    return prisma.shipmentTask.upsert({ where: { id }, create: r as any, update: data as any });
  });
  await upsertAll('shipment_task_lines', taskLines, async (r) => {
    const { id, ...data } = r;
    return prisma.shipmentTaskLine.upsert({ where: { id }, create: r as any, update: data as any });
  });

  console.log('[import] OK');
}

main()
  .catch((e) => {
    console.error('[import] FAILED', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

