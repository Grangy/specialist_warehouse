import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import {
  appendReceiptAudit,
  evaluateMarkingScan,
  serializeReceiptSummary,
  computeReceiptPoints,
  getReceiptPointsRates,
  DISCREPANCY_TYPE_LABELS,
} from '@/lib/receipts';
import { normalizeHonestSignCode, describeHonestSignRaw } from '@/lib/honestSign';
import { append1cLog } from '@/lib/1cLog';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function loadReceipt(id: string) {
  return prisma.receipt.findFirst({
    where: { id, deleted: false },
    include: {
      receiver: { select: { id: true, name: true, login: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        include: {
          expectedCodes: { orderBy: { unitIndex: 'asc' } },
          scannedCodes: { orderBy: { scannedAt: 'asc' } },
        },
      },
      discrepancies: { orderBy: { createdAt: 'asc' } },
      auditLogs: { orderBy: { createdAt: 'desc' }, take: 100 },
      _count: { select: { discrepancies: true } },
    },
  });
}

function canAccessReceipt(
  user: { id: string; role: string },
  receipt: { receiverId: string | null; status: string }
): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'receiver') {
    if (!receipt.receiverId) return true;
    return receipt.receiverId === user.id;
  }
  // workMode receiving: collectors/checkers may work if unassigned or theirs
  if (!receipt.receiverId) return true;
  return receipt.receiverId === user.id;
}

export async function GET(request: NextRequest, ctx: Ctx) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await ctx.params;

  const receipt = await loadReceipt(id);
  if (!receipt) return NextResponse.json({ error: 'Приёмка не найдена' }, { status: 404 });
  if (!canAccessReceipt(user, receipt)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }

  return NextResponse.json({
    receipt: {
      ...serializeReceiptSummary(receipt),
      comment: receipt.comment,
      lines: receipt.lines.map((l) => ({
        id: l.id,
        sku: l.sku,
        art: l.art,
        barcode: l.barcode,
        name: l.name,
        uom: l.uom,
        planned_qty: l.plannedQty,
        actual_qty: l.actualQty,
        discrepancy_qty: l.discrepancyQty,
        requires_marking_scan: l.requiresMarkingScan,
        checked: l.checked,
        line_comment: l.lineComment,
        expected_marking_codes: l.expectedCodes.map((c) => c.code),
        scanned_marking_codes: l.scannedCodes.map((c) => ({
          code: c.code,
          result: c.result,
          scanned_at: c.scannedAt.toISOString(),
        })),
        matched_codes_count: l.scannedCodes.filter((c) => c.result === 'matched').length,
        expected_codes_count: l.expectedCodes.length,
      })),
      discrepancies: receipt.discrepancies.map((d) => ({
        id: d.id,
        type: d.type,
        type_label: DISCREPANCY_TYPE_LABELS[d.type] ?? d.type,
        qty: d.qty,
        comment: d.comment,
        scanned_code: d.scannedCode,
        line_id: d.receiptLineId,
        created_at: d.createdAt.toISOString(),
      })),
      audit_log: receipt.auditLogs.map((a) => ({
        id: a.id,
        action: a.action,
        user_id: a.userId,
        details: a.details,
        created_at: a.createdAt.toISOString(),
      })),
    },
  });
}

/**
 * PATCH /api/receipts/[id]
 * body.action: start | set_qty | scan | add_discrepancy | complete | cancel | reassign
 */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;
  const { user } = authResult;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '');

  const receipt = await loadReceipt(id);
  if (!receipt) return NextResponse.json({ error: 'Приёмка не найдена' }, { status: 404 });

  if (action === 'reassign' || action === 'cancel') {
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Только админ' }, { status: 403 });
    }
  } else if (!canAccessReceipt(user, receipt)) {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  }

  try {
    if (action === 'start') {
      if (['completed', 'completed_with_discrepancies', 'cancelled'].includes(receipt.status)) {
        return NextResponse.json({ error: 'Документ уже завершён или отменён' }, { status: 409 });
      }
      if (receipt.receiverId && receipt.receiverId !== user.id && user.role !== 'admin') {
        return NextResponse.json({ error: 'Приёмку уже взял другой пользователь' }, { status: 409 });
      }
      const updated = await prisma.receipt.update({
        where: { id },
        data: {
          status: 'in_progress',
          receiverId: user.id,
          startedAt: receipt.startedAt ?? new Date(),
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'start',
      });
      return NextResponse.json({ success: true, status: updated.status });
    }

    if (action === 'set_qty') {
      const lineId = String(body.lineId || body.line_id || '');
      const qty = Number(body.actualQty ?? body.actual_qty);
      if (!lineId || !Number.isFinite(qty) || qty < 0) {
        return NextResponse.json({ error: 'Нужны lineId и actualQty >= 0' }, { status: 400 });
      }
      if (receipt.status !== 'in_progress' && receipt.status !== 'awaiting_start') {
        return NextResponse.json({ error: 'Приёмка не в работе' }, { status: 409 });
      }
      const line = receipt.lines.find((l) => l.id === lineId);
      if (!line) return NextResponse.json({ error: 'Позиция не найдена' }, { status: 404 });

      if (line.requiresMarkingScan) {
        const matched = line.scannedCodes.filter((c) => c.result === 'matched').length;
        if (qty > 0 && matched < qty) {
          return NextResponse.json(
            {
              error: `Для маркированного товара нужно отсканировать ${qty} код(ов), сейчас совпало: ${matched}`,
            },
            { status: 400 }
          );
        }
      }

      const discrepancyQty = qty - line.plannedQty;
      await prisma.receiptLine.update({
        where: { id: lineId },
        data: {
          actualQty: qty,
          discrepancyQty,
          checked: true,
          lineComment: body.comment != null ? String(body.comment) : undefined,
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'qty_changed',
        details: { lineId, sku: line.sku, actualQty: qty, plannedQty: line.plannedQty },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'scan') {
      const lineId = String(body.lineId || body.line_id || '');
      const rawCode = String(body.code || '');
      const clientMeta =
        body.clientMeta && typeof body.clientMeta === 'object'
          ? (body.clientMeta as Record<string, unknown>)
          : body.client_meta && typeof body.client_meta === 'object'
            ? (body.client_meta as Record<string, unknown>)
            : {};
      const rawDesc = describeHonestSignRaw(rawCode);

      append1cLog({
        ts: new Date().toISOString(),
        type: 'marking-scan',
        direction: 'in',
        endpoint: `PATCH /api/receipts/${id}`,
        summary: `Скан ЧЗ receipt=${receipt.number} line=${lineId.slice(0, 8)}… raw_len=${rawDesc.raw_length}`,
        details: {
          receipt_id: id,
          receipt_number: receipt.number,
          line_id: lineId,
          user_id: user.id,
          user_login: user.login,
          ...rawDesc,
          // raw целиком для аудита (может быть длинным)
          raw_full: rawDesc.raw,
          client_meta: clientMeta,
        },
      });

      if (!lineId || !rawCode) {
        return NextResponse.json(
          { error: 'Нужны lineId и code', debug: rawDesc },
          { status: 400 }
        );
      }
      if (receipt.status !== 'in_progress' && receipt.status !== 'awaiting_start') {
        return NextResponse.json({ error: 'Приёмка не в работе' }, { status: 409 });
      }
      const line = receipt.lines.find((l) => l.id === lineId);
      if (!line) return NextResponse.json({ error: 'Позиция не найдена' }, { status: 404 });
      if (!line.requiresMarkingScan) {
        return NextResponse.json({ error: 'Для этой позиции сканирование ЧЗ не требуется' }, { status: 400 });
      }

      const expectedByLineId = new Map<string, string[]>();
      for (const l of receipt.lines) {
        expectedByLineId.set(
          l.id,
          l.expectedCodes.map((c) => c.code)
        );
      }
      const alreadyMatched = new Set(
        receipt.lines
          .flatMap((l) => l.scannedCodes)
          .filter((c) => c.result === 'matched')
          .map((c) => c.code)
      );

      const evalResult = evaluateMarkingScan({
        rawCode,
        lineId,
        expectedOnLine: line.expectedCodes.map((c) => c.code),
        expectedByLineId,
        alreadyScannedMatched: alreadyMatched,
      });

      const code = normalizeHonestSignCode(rawCode) || rawCode.trim();
      await prisma.receiptScannedMarkingCode.create({
        data: {
          receiptLineId: lineId,
          code,
          result: evalResult.result,
          scannedById: user.id,
          note: evalResult.message,
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: evalResult.result === 'matched' ? 'scan' : 'scan_error',
        details: {
          lineId,
          result: evalResult.result,
          message: evalResult.message,
          raw_length: rawDesc.raw_length,
          raw_hex_preview: rawDesc.raw_hex_preview,
          leading_gs: rawDesc.leading_gs,
          has_gs: rawDesc.has_gs,
          normalized: rawDesc.normalized,
          code_saved: code.slice(0, 96),
          client_meta: clientMeta,
        },
      });

      append1cLog({
        ts: new Date().toISOString(),
        type: 'marking-scan',
        direction: 'out',
        endpoint: `PATCH /api/receipts/${id}`,
        summary: `Скан результат=${evalResult.result} number=${receipt.number}`,
        details: {
          receipt_id: id,
          result: evalResult.result,
          message: evalResult.message,
          normalized: rawDesc.normalized,
          raw_length: rawDesc.raw_length,
        },
      });

      const expectedCount = line.expectedCodes.length || line.plannedQty;
      let matchedCount = line.scannedCodes.filter((c) => c.result === 'matched').length;

      // Авто-увеличение actual при успешном скане
      if (evalResult.result === 'matched') {
        matchedCount += 1;
        await prisma.receiptLine.update({
          where: { id: lineId },
          data: {
            actualQty: matchedCount,
            discrepancyQty: matchedCount - line.plannedQty,
            checked: matchedCount >= line.plannedQty,
          },
        });
      }

      return NextResponse.json({
        success: evalResult.result === 'matched',
        result: evalResult.result,
        message: evalResult.message,
        matched_count: matchedCount,
        expected_count: expectedCount,
        line_complete: matchedCount >= expectedCount && expectedCount > 0,
        debug: {
          raw_length: rawDesc.raw_length,
          normalized: rawDesc.normalized,
          leading_gs: rawDesc.leading_gs,
          has_gs: rawDesc.has_gs,
          raw_preview: rawDesc.raw.slice(0, 80),
          hex_preview: rawDesc.raw_hex_preview.slice(0, 64),
        },
      });
    }

    if (action === 'add_discrepancy') {
      const type = String(body.type || '');
      if (!DISCREPANCY_TYPE_LABELS[type]) {
        return NextResponse.json(
          { error: 'Неверный type', allowed: Object.keys(DISCREPANCY_TYPE_LABELS) },
          { status: 400 }
        );
      }
      const qty = Math.max(1, Number(body.qty) || 1);
      const disc = await prisma.receiptDiscrepancy.create({
        data: {
          receiptId: id,
          receiptLineId: body.lineId || body.line_id || null,
          type: type as any,
          qty,
          comment: body.comment != null ? String(body.comment) : null,
          scannedCode: body.scannedCode || body.scanned_code || null,
          userId: user.id,
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'discrepancy',
        details: { discrepancyId: disc.id, type, qty },
      });
      return NextResponse.json({ success: true, discrepancy_id: disc.id });
    }

    if (action === 'complete') {
      if (receipt.status === 'completed' || receipt.status === 'completed_with_discrepancies') {
        return NextResponse.json({ error: 'Документ уже завершён' }, { status: 409 });
      }
      if (receipt.receiverId && receipt.receiverId !== user.id && user.role !== 'admin') {
        return NextResponse.json({ error: 'Документ закреплён за другим приёмщиком' }, { status: 409 });
      }

      const unchecked = receipt.lines.filter((l) => !l.checked);
      if (unchecked.length > 0) {
        return NextResponse.json(
          {
            error: 'Остались непроверенные позиции',
            unchecked: unchecked.map((l) => ({ id: l.id, sku: l.sku, name: l.name })),
          },
          { status: 400 }
        );
      }

      for (const l of receipt.lines) {
        if (!l.requiresMarkingScan) continue;
        const matched = l.scannedCodes.filter((c) => c.result === 'matched').length;
        const actual = l.actualQty ?? 0;
        if (matched < actual) {
          return NextResponse.json(
            {
              error: `Позиция ${l.sku}: отсканировано совпадений ${matched}, принято ${actual}`,
            },
            { status: 400 }
          );
        }
        if (matched !== actual) {
          return NextResponse.json(
            {
              error: `Позиция ${l.sku}: число совпавших кодов должно равняться принятому количеству`,
            },
            { status: 400 }
          );
        }
      }

      // Расхождения qty без типа — требуем reason
      const qtyMismatches = receipt.lines.filter(
        (l) => (l.actualQty ?? 0) !== l.plannedQty
      );
      if (qtyMismatches.length > 0 && receipt.discrepancies.length === 0 && !body.force) {
        return NextResponse.json(
          {
            error: 'Есть расхождения по количеству — укажите причину (add_discrepancy) или force=true с комментарием',
            mismatches: qtyMismatches.map((l) => ({
              sku: l.sku,
              planned: l.plannedQty,
              actual: l.actualQty,
            })),
          },
          { status: 400 }
        );
      }

      const actualUnits = receipt.lines.reduce((s, l) => s + (l.actualQty ?? 0), 0);
      const matchedMarking = receipt.lines.reduce(
        (s, l) => s + l.scannedCodes.filter((c) => c.result === 'matched').length,
        0
      );
      const discCount = receipt.discrepancies.length + qtyMismatches.length;
      const rates = await getReceiptPointsRates(prisma);
      const durationMin =
        receipt.startedAt != null
          ? (Date.now() - receipt.startedAt.getTime()) / 60000
          : null;
      const points = computeReceiptPoints({
        rates,
        acceptedUnits: actualUnits,
        matchedMarkingUnits: matchedMarking,
        discrepancyCount: discCount,
        durationMinutes: durationMin,
        plannedUnits: receipt.plannedUnitsCount,
      });

      const finalStatus =
        discCount > 0 || qtyMismatches.length > 0
          ? 'completed_with_discrepancies'
          : 'completed';

      await prisma.receipt.update({
        where: { id },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          actualUnitsCount: actualUnits,
          pointsAwarded: points,
          receiverId: receipt.receiverId ?? user.id,
          comment: body.comment != null ? String(body.comment) : receipt.comment,
          exportedTo1C: false,
          exportedTo1CAt: null,
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'complete',
        details: { status: finalStatus, points, actualUnits },
      });

      return NextResponse.json({
        success: true,
        status: finalStatus,
        points_awarded: points,
        actual_units: actualUnits,
      });
    }

    if (action === 'cancel') {
      await prisma.receipt.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'cancel',
      });
      return NextResponse.json({ success: true, status: 'cancelled' });
    }

    if (action === 'reassign') {
      const receiverId = body.receiverId || body.receiver_id || null;
      await prisma.receipt.update({
        where: { id },
        data: { receiverId },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'reassign',
        details: { receiverId },
      });
      return NextResponse.json({ success: true });
    }

    if (action === 'reset_export') {
      if (user.role !== 'admin') {
        return NextResponse.json({ error: 'Только админ' }, { status: 403 });
      }
      await prisma.receipt.update({
        where: { id },
        data: {
          exportedTo1C: false,
          exportedTo1CAt: null,
          syncError: null,
          status:
            receipt.status === 'sync_error'
              ? receipt.discrepancies.length > 0
                ? 'completed_with_discrepancies'
                : 'completed'
              : receipt.status,
        },
      });
      await appendReceiptAudit(prisma, {
        receiptId: id,
        userId: user.id,
        action: 'sync_1c',
        details: { reset_export: true },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Неизвестное action: ${action}` }, { status: 400 });
  } catch (error: unknown) {
    console.error('[API Receipts PATCH]', error);
    return NextResponse.json(
      { error: 'Ошибка операции', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
