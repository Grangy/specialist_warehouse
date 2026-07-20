/**
 * Модуль приёмки: константы, сериализация, валидация скана ЧЗ, баллы.
 */

import type { prisma as PrismaClient } from '@/lib/prisma';
import { honestSignMatchKey, normalizeHonestSignCode } from '@/lib/honestSign';

type PrismaLike = typeof PrismaClient;

export const RECEIPT_STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  awaiting_start: 'Ожидает начала',
  in_progress: 'В работе',
  completed: 'Завершена',
  completed_with_discrepancies: 'Завершена с расхождениями',
  cancelled: 'Отменена',
  sync_error: 'Ошибка синхронизации с 1С',
};

export const DISCREPANCY_TYPE_LABELS: Record<string, string> = {
  shortage: 'Недостача',
  surplus: 'Излишек',
  damage: 'Повреждение',
  wrong_item: 'Неправильный товар',
  missing_marking_code: 'Отсутствие кода маркировки',
  marking_code_mismatch: 'Несовпадение кода маркировки',
  other: 'Другое',
};

/** Ключ SystemSettings для коэффициентов баллов приёмки */
export const RECEIPT_POINTS_SETTINGS_KEY = 'receipt_points_rates';

export type ReceiptPointsRates = {
  /** Баллы за каждую принятую единицу */
  perAcceptedUnit: number;
  /** Доп. баллы за каждую успешно сверенную маркированную единицу */
  perMatchedMarkingUnit: number;
  /** Штраф за каждое зафиксированное расхождение */
  perDiscrepancy: number;
  /** Бонус за приёмку без расхождений */
  noDiscrepancyBonus: number;
  /** Коэффициент скорости: base / (durationMin / plannedUnits) — опционально */
  speedBonusMax: number;
};

export const DEFAULT_RECEIPT_POINTS_RATES: ReceiptPointsRates = {
  perAcceptedUnit: 0.5,
  perMatchedMarkingUnit: 0.3,
  perDiscrepancy: -1,
  noDiscrepancyBonus: 5,
  speedBonusMax: 10,
};

export async function getReceiptPointsRates(prisma: PrismaLike): Promise<ReceiptPointsRates> {
  const row = await prisma.systemSettings.findUnique({ where: { key: RECEIPT_POINTS_SETTINGS_KEY } });
  if (!row?.value) return { ...DEFAULT_RECEIPT_POINTS_RATES };
  try {
    const parsed = JSON.parse(row.value) as Partial<ReceiptPointsRates>;
    return { ...DEFAULT_RECEIPT_POINTS_RATES, ...parsed };
  } catch {
    return { ...DEFAULT_RECEIPT_POINTS_RATES };
  }
}

export async function appendReceiptAudit(
  prisma: PrismaLike,
  opts: { receiptId: string; userId?: string | null; action: string; details?: unknown }
): Promise<void> {
  await prisma.receiptAuditLog.create({
    data: {
      receiptId: opts.receiptId,
      userId: opts.userId ?? null,
      action: opts.action,
      details: opts.details != null ? JSON.stringify(opts.details) : null,
    },
  });
}

export function parseRequiresMarking(line: Record<string, unknown>): boolean {
  const raw =
    line.requiresMarkingScan ??
    line.requires_marking_scan ??
    line.hasHonestSign ??
    line.has_honest_sign ??
    line.requiresHonestSign;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'да';
  }
  return false;
}

export function parseExpectedCodes(line: Record<string, unknown>): string[] {
  const raw =
    line.expectedMarkingCodes ??
    line.expected_marking_codes ??
    line.honestSignCodes ??
    line.honest_sign_codes ??
    line.markingCodes ??
    line.marking_codes;
  if (raw == null) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const item of arr) {
    if (item == null) continue;
    if (typeof item === 'string' || typeof item === 'number') {
      const n = normalizeHonestSignCode(item);
      if (n) out.push(n);
      continue;
    }
    if (typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const n = normalizeHonestSignCode(o.code ?? o.cis ?? o.km ?? o.value);
      if (n) out.push(n);
    }
  }
  return out;
}

export type ScanEval =
  | { result: 'matched'; message: string }
  | { result: 'already_scanned'; message: string }
  | { result: 'wrong_item'; message: string }
  | { result: 'not_found'; message: string }
  | { result: 'invalid_format'; message: string }
  | { result: 'missing_in_receipt'; message: string };

/**
 * Оценка скана кода относительно ожидаемых кодов строки / всего документа.
 */
export function evaluateMarkingScan(opts: {
  rawCode: string;
  lineId: string;
  expectedOnLine: string[];
  expectedByLineId: Map<string, string[]>;
  alreadyScannedMatched: Set<string>;
}): ScanEval {
  const code = honestSignMatchKey(opts.rawCode);
  if (!code || code.length < 8) {
    return { result: 'invalid_format', message: 'Неверный формат кода маркировки' };
  }

  const expectedOnLine = opts.expectedOnLine
    .map((c) => honestSignMatchKey(c))
    .filter((c): c is string => !!c);
  const already = new Set(
    [...opts.alreadyScannedMatched].map((c) => honestSignMatchKey(c)).filter((c): c is string => !!c)
  );

  if (already.has(code)) {
    return { result: 'already_scanned', message: 'Этот код уже был отсканирован' };
  }
  if (expectedOnLine.includes(code)) {
    return { result: 'matched', message: 'Код совпал' };
  }

  // Префиксное совпадение: 1С без хвоста, камера с хвостом (после нормализации обычно уже равно)
  const prefixHit = expectedOnLine.find((exp) => code.startsWith(exp) || exp.startsWith(code));
  if (prefixHit) {
    return { result: 'matched', message: 'Код совпал' };
  }

  for (const [otherLineId, codes] of opts.expectedByLineId) {
    if (otherLineId === opts.lineId) continue;
    const norms = codes.map((c) => honestSignMatchKey(c)).filter((c): c is string => !!c);
    if (norms.includes(code) || norms.some((exp) => code.startsWith(exp) || exp.startsWith(code))) {
      return { result: 'wrong_item', message: 'Код относится к другому товару в этой приёмке' };
    }
  }

  let inReceipt = false;
  for (const codes of opts.expectedByLineId.values()) {
    const norms = codes.map((c) => honestSignMatchKey(c)).filter((c): c is string => !!c);
    if (norms.includes(code) || norms.some((exp) => code.startsWith(exp) || exp.startsWith(code))) {
      inReceipt = true;
      break;
    }
  }
  if (!inReceipt) {
    return { result: 'missing_in_receipt', message: 'Код отсутствует в данных приёмки из 1С' };
  }
  return { result: 'not_found', message: 'Код не найден среди ожидаемых для этой позиции' };
}

export function computeReceiptPoints(opts: {
  rates: ReceiptPointsRates;
  acceptedUnits: number;
  matchedMarkingUnits: number;
  discrepancyCount: number;
  durationMinutes: number | null;
  plannedUnits: number;
}): number {
  const { rates } = opts;
  let pts =
    opts.acceptedUnits * rates.perAcceptedUnit +
    opts.matchedMarkingUnits * rates.perMatchedMarkingUnit +
    opts.discrepancyCount * rates.perDiscrepancy;
  if (opts.discrepancyCount === 0) pts += rates.noDiscrepancyBonus;
  if (
    opts.durationMinutes != null &&
    opts.durationMinutes > 0 &&
    opts.plannedUnits > 0 &&
    rates.speedBonusMax > 0
  ) {
    // Быстрее целевого темпа (1 ед / мин) → бонус до speedBonusMax
    const unitsPerMin = opts.acceptedUnits / opts.durationMinutes;
    if (unitsPerMin > 1) {
      const ratio = Math.min(2, unitsPerMin);
      pts += rates.speedBonusMax * ((ratio - 1) / 1);
    }
  }
  return Math.round(Math.max(0, pts) * 10) / 10;
}

export function serializeReceiptSummary(r: {
  id: string;
  externalId: string;
  number: string;
  status: string;
  warehouse: string | null;
  supplierName: string | null;
  createdAt: Date;
  documentDate: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  receiverId: string | null;
  plannedItemsCount: number;
  plannedUnitsCount: number;
  actualUnitsCount: number;
  exportedTo1C: boolean;
  pointsAwarded: number | null;
  syncError: string | null;
  receiver?: { id: string; name: string } | null;
  lines?: Array<{ requiresMarkingScan: boolean; plannedQty: number; actualQty: number | null; checked: boolean }>;
  _count?: { discrepancies: number };
}) {
  const lines = r.lines ?? [];
  const markingLines = lines.filter((l) => l.requiresMarkingScan);
  const markingUnits = markingLines.reduce((s, l) => s + l.plannedQty, 0);
  const checkedCount = lines.filter((l) => l.checked).length;
  const progressPct = lines.length > 0 ? Math.round((checkedCount / lines.length) * 1000) / 10 : 0;
  return {
    id: r.id,
    external_id: r.externalId,
    number: r.number,
    status: r.status,
    status_label: RECEIPT_STATUS_LABELS[r.status] ?? r.status,
    warehouse: r.warehouse,
    supplier_name: r.supplierName,
    created_at: r.createdAt.toISOString(),
    document_date: r.documentDate?.toISOString() ?? null,
    started_at: r.startedAt?.toISOString() ?? null,
    completed_at: r.completedAt?.toISOString() ?? null,
    receiver_id: r.receiverId,
    receiver_name: r.receiver?.name ?? null,
    planned_items_count: r.plannedItemsCount,
    planned_units_count: r.plannedUnitsCount,
    actual_units_count: r.actualUnitsCount,
    progress_pct: progressPct,
    checked_lines: checkedCount,
    total_lines: lines.length || r.plannedItemsCount,
    marking_lines_count: markingLines.length,
    marking_units_count: markingUnits,
    discrepancies_count: r._count?.discrepancies ?? 0,
    exported_to_1c: r.exportedTo1C,
    points_awarded: r.pointsAwarded,
    sync_error: r.syncError,
  };
}

export function buildReceiptExportPayload(receipt: {
  id: string;
  externalId: string;
  number: string;
  status: string;
  warehouse: string | null;
  supplierName: string | null;
  completedAt: Date | null;
  receiverId: string | null;
  comment: string;
  plannedUnitsCount: number;
  actualUnitsCount: number;
  pointsAwarded: number | null;
  receiver?: { id: string; name: string; login: string } | null;
  lines: Array<{
    id: string;
    sku: string;
    art: string | null;
    barcode: string | null;
    name: string;
    uom: string;
    plannedQty: number;
    actualQty: number | null;
    discrepancyQty: number;
    requiresMarkingScan: boolean;
    expectedCodes: Array<{ code: string; unitIndex: number }>;
    scannedCodes: Array<{ code: string; result: string; scannedAt: Date }>;
  }>;
  discrepancies: Array<{
    type: string;
    qty: number;
    comment: string | null;
    scannedCode: string | null;
    receiptLineId: string | null;
    createdAt: Date;
  }>;
}) {
  const shortage = receipt.lines.reduce((s, l) => {
    const actual = l.actualQty ?? 0;
    return s + Math.max(0, l.plannedQty - actual);
  }, 0);
  const surplus = receipt.lines.reduce((s, l) => {
    const actual = l.actualQty ?? 0;
    return s + Math.max(0, actual - l.plannedQty);
  }, 0);

  return {
    id: receipt.id,
    external_id: receipt.externalId,
    number: receipt.number,
    status: receipt.status,
    warehouse: receipt.warehouse,
    supplier_name: receipt.supplierName,
    completed_at: receipt.completedAt?.toISOString() ?? null,
    receiver: receipt.receiver
      ? { id: receipt.receiver.id, name: receipt.receiver.name, login: receipt.receiver.login }
      : null,
    planned_units: receipt.plannedUnitsCount,
    actual_units: receipt.actualUnitsCount,
    shortage_units: shortage,
    surplus_units: surplus,
    points_awarded: receipt.pointsAwarded,
    comment: receipt.comment || '',
    lines: receipt.lines.map((l) => ({
      sku: l.sku,
      art: l.art,
      barcode: l.barcode,
      name: l.name,
      uom: l.uom,
      planned_qty: l.plannedQty,
      actual_qty: l.actualQty ?? 0,
      discrepancy_qty: l.discrepancyQty,
      requires_marking_scan: l.requiresMarkingScan,
      expected_marking_codes: [...l.expectedCodes]
        .sort((a, b) => a.unitIndex - b.unitIndex)
        .map((c) => c.code),
      scanned_marking_codes: l.scannedCodes.map((c) => ({
        code: c.code,
        result: c.result,
        scanned_at: c.scannedAt.toISOString(),
      })),
    })),
    discrepancies: receipt.discrepancies.map((d) => ({
      type: d.type,
      type_label: DISCREPANCY_TYPE_LABELS[d.type] ?? d.type,
      qty: d.qty,
      comment: d.comment,
      scanned_code: d.scannedCode,
      line_id: d.receiptLineId,
      created_at: d.createdAt.toISOString(),
    })),
  };
}
