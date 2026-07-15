import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
import { append1cLog } from '@/lib/1cLog';
import {
  appendReceiptAudit,
  parseExpectedCodes,
  parseRequiresMarking,
} from '@/lib/receipts';
import { normalizeHonestSignCode } from '@/lib/honestSign';

export const dynamic = 'force-dynamic';

/**
 * POST /api/receipts — приём документа приёмки из 1С.
 * Идемпотентность по externalId (или number+supplier).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const authResult = await authenticateRequest(request, body, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const externalId = String(
      body.externalId ?? body.external_id ?? body.id ?? ''
    ).trim();
    const number = String(body.number ?? '').trim();
    const linesIn = Array.isArray(body.lines) ? body.lines : [];

    if (!externalId) {
      return NextResponse.json(
        { success: false, error: 'Требуется externalId (идентификатор приёмки из 1С)' },
        { status: 400 }
      );
    }
    if (!number) {
      return NextResponse.json({ success: false, error: 'Требуется number' }, { status: 400 });
    }
    if (linesIn.length === 0) {
      return NextResponse.json({ success: false, error: 'Требуется непустой lines[]' }, { status: 400 });
    }

    append1cLog({
      ts: new Date().toISOString(),
      type: 'receipts-post',
      direction: 'in',
      endpoint: 'POST /api/receipts',
      summary: `Приёмка ${number} (externalId=${externalId}), позиций ${linesIn.length}`,
      details: { externalId, number, linesCount: linesIn.length },
    });

    const existing = await prisma.receipt.findUnique({ where: { externalId } });
    if (existing && !existing.deleted) {
      if (['in_progress', 'completed', 'completed_with_discrepancies'].includes(existing.status)) {
        return NextResponse.json(
          {
            success: false,
            skipped: true,
            message: `Приёмка ${number} уже в работе или завершена — повтор не принимается`,
            receipt_id: existing.id,
            status: existing.status,
          },
          { status: 200 }
        );
      }
    }

    // Валидация строк + кодов ЧЗ
    type PrepLine = {
      sku: string;
      art: string | null;
      barcode: string | null;
      name: string;
      uom: string;
      plannedQty: number;
      requiresMarkingScan: boolean;
      codes: string[];
      sortOrder: number;
    };
    const prep: PrepLine[] = [];
    const seenCodes = new Set<string>();
    const errors: string[] = [];

    for (let i = 0; i < linesIn.length; i++) {
      const raw = linesIn[i] as Record<string, unknown>;
      const sku = String(raw.sku ?? raw.productId ?? raw.product_id ?? '').trim();
      const name = String(raw.name ?? '').trim() || sku;
      const plannedQty = Number(raw.plannedQty ?? raw.planned_qty ?? raw.qty ?? 0) || 0;
      const requires = parseRequiresMarking(raw);
      const codes = parseExpectedCodes(raw).map((c) => normalizeHonestSignCode(c)!).filter(Boolean);

      if (!sku) errors.push(`Строка ${i + 1}: пустой sku`);
      if (plannedQty <= 0) errors.push(`Строка ${i + 1} (${sku}): plannedQty должен быть > 0`);

      if (requires) {
        if (codes.length === 0) {
          errors.push(`Строка ${i + 1} (${sku}): requires_marking_scan=true, но коды не переданы`);
        } else if (codes.length !== plannedQty) {
          errors.push(
            `Строка ${i + 1} (${sku}): число кодов (${codes.length}) ≠ plannedQty (${plannedQty})`
          );
        }
        for (const c of codes) {
          if (seenCodes.has(c)) errors.push(`Дубликат кода маркировки в документе: ${c.slice(0, 40)}…`);
          seenCodes.add(c);
        }
      }

      prep.push({
        sku,
        art: raw.art != null ? String(raw.art) : null,
        barcode: raw.barcode != null ? String(raw.barcode) : null,
        name,
        uom: String(raw.uom ?? 'шт'),
        plannedQty,
        requiresMarkingScan: requires || codes.length > 0,
        codes: requires || codes.length > 0 ? codes : [],
        sortOrder: i,
      });
    }

    if (errors.length) {
      append1cLog({
        ts: new Date().toISOString(),
        type: 'receipts-post',
        direction: 'out',
        endpoint: 'POST /api/receipts',
        summary: `Приёмка ${number} отклонена: валидация`,
        details: { errors },
      });
      return NextResponse.json({ success: false, error: 'Ошибка валидации', details: errors }, { status: 400 });
    }

    const plannedItems = prep.length;
    const plannedUnits = prep.reduce((s, l) => s + l.plannedQty, 0);
    const warehouse = body.warehouse != null ? String(body.warehouse) : null;
    const supplierName = body.supplierName ?? body.supplier_name ?? body.supplier ?? null;
    const documentDate = body.documentDate || body.document_date || body.date
      ? new Date(body.documentDate || body.document_date || body.date)
      : null;
    const comment = String(body.comment ?? '');

    try {
      const receipt = await prisma.$transaction(async (tx) => {
        if (existing) {
          await tx.receiptExpectedMarkingCode.deleteMany({
            where: { receiptLine: { receiptId: existing.id } },
          });
          await tx.receiptScannedMarkingCode.deleteMany({
            where: { receiptLine: { receiptId: existing.id } },
          });
          await tx.receiptDiscrepancy.deleteMany({ where: { receiptId: existing.id } });
          await tx.receiptLine.deleteMany({ where: { receiptId: existing.id } });
          await tx.receipt.update({
            where: { id: existing.id },
            data: {
              number,
              status: 'awaiting_start',
              warehouse,
              supplierName: supplierName != null ? String(supplierName) : null,
              documentDate: documentDate && !Number.isNaN(documentDate.getTime()) ? documentDate : null,
              comment,
              plannedItemsCount: plannedItems,
              plannedUnitsCount: plannedUnits,
              actualUnitsCount: 0,
              receiverId: null,
              startedAt: null,
              completedAt: null,
              exportedTo1C: false,
              exportedTo1CAt: null,
              syncError: null,
              deleted: false,
              deletedAt: null,
              pointsAwarded: null,
            },
          });
        } else {
          await tx.receipt.create({
            data: {
              externalId,
              number,
              status: 'awaiting_start',
              warehouse,
              supplierName: supplierName != null ? String(supplierName) : null,
              documentDate: documentDate && !Number.isNaN(documentDate.getTime()) ? documentDate : null,
              comment,
              plannedItemsCount: plannedItems,
              plannedUnitsCount: plannedUnits,
            },
          });
        }

        const rec = await tx.receipt.findUniqueOrThrow({ where: { externalId } });

        for (const pl of prep) {
          const line = await tx.receiptLine.create({
            data: {
              receiptId: rec.id,
              sku: pl.sku,
              art: pl.art,
              barcode: pl.barcode,
              name: pl.name,
              uom: pl.uom,
              plannedQty: pl.plannedQty,
              requiresMarkingScan: pl.requiresMarkingScan,
              sortOrder: pl.sortOrder,
            },
          });
          if (pl.codes.length) {
            await tx.receiptExpectedMarkingCode.createMany({
              data: pl.codes.map((code, idx) => ({
                receiptLineId: line.id,
                code,
                unitIndex: idx + 1,
              })),
            });
          }
        }

        await tx.receiptAuditLog.create({
          data: {
            receiptId: rec.id,
            action: 'received_from_1c',
            details: JSON.stringify({
              externalId,
              number,
              lines: plannedItems,
              units: plannedUnits,
              replaced: !!existing,
            }),
          },
        });

        return rec;
      });

      append1cLog({
        ts: new Date().toISOString(),
        type: 'receipts-post',
        direction: 'out',
        endpoint: 'POST /api/receipts',
        summary: `Приёмка ${number} ${existing ? 'обновлена' : 'создана'}`,
        details: { receiptId: receipt.id, externalId },
      });

      return NextResponse.json(
        {
          success: true,
          message: existing ? 'Приёмка обновлена' : 'Приёмка создана',
          receipt: {
            id: receipt.id,
            external_id: receipt.externalId,
            number: receipt.number,
            status: receipt.status,
            planned_items_count: plannedItems,
            planned_units_count: plannedUnits,
          },
        },
        { status: existing ? 200 : 201 }
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const isUnique =
        msg.includes('Unique') || msg.includes('UNIQUE') || (e as { code?: string })?.code === 'P2002';
      if (isUnique) {
        return NextResponse.json(
          {
            success: false,
            error: 'Код маркировки уже используется в другой приёмке',
            details: msg,
          },
          { status: 409 }
        );
      }
      throw e;
    }
  } catch (error: unknown) {
    console.error('[API Receipts POST]', error);
    return NextResponse.json(
      { success: false, error: 'Ошибка создания приёмки', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/receipts — список приёмок для приёмщика / админа.
 * Query: status, mine=1
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request, {}, ['admin', 'receiver', 'collector', 'checker', 'warehouse_3']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const mine = searchParams.get('mine') === '1';
    const forReceiverUi = user.role === 'receiver' || searchParams.get('mode') === 'receiving';

    const where: Record<string, unknown> = { deleted: false };
    if (status) where.status = status;
    if (mine) where.receiverId = user.id;
    // Приёмщик видит только незавершённые и свои в работе, плюс завершённые свои за сегодня — упрощённо: все не cancelled
    if (forReceiverUi && user.role === 'receiver') {
      where.status = status
        ? status
        : { in: ['new', 'awaiting_start', 'in_progress', 'completed', 'completed_with_discrepancies', 'sync_error'] };
    }

    const { serializeReceiptSummary } = await import('@/lib/receipts');
    const rows = await prisma.receipt.findMany({
      where,
      include: {
        receiver: { select: { id: true, name: true } },
        lines: {
          select: {
            requiresMarkingScan: true,
            plannedQty: true,
            actualQty: true,
            checked: true,
          },
        },
        _count: { select: { discrepancies: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
    });

    return NextResponse.json({
      receipts: rows.map(serializeReceiptSummary),
      count: rows.length,
    });
  } catch (error: unknown) {
    console.error('[API Receipts GET]', error);
    return NextResponse.json({ error: 'Ошибка получения списка приёмок' }, { status: 500 });
  }
}
