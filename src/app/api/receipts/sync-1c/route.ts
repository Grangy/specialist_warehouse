import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
import { append1cLog } from '@/lib/1cLog';
import { appendReceiptAudit, buildReceiptExportPayload } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

const COMPLETED = ['completed', 'completed_with_discrepancies'] as const;

/**
 * POST /api/receipts/sync-1c
 * body.receipts: [{ id | external_id | number, success: boolean }]
 * Ответ: следующий batch ready-for-export.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const authResult = await authenticateRequest(request, body, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const items = Array.isArray(body.receipts) ? body.receipts : Array.isArray(body.orders) ? body.orders : [];
    append1cLog({
      ts: new Date().toISOString(),
      type: 'receipts-sync-1c',
      direction: 'in',
      endpoint: 'POST /api/receipts/sync-1c',
      summary: `ACK по ${items.length} приёмкам`,
      details: { items },
    });

    for (const item of items) {
      const success = item.success === true || item.success === 'true' || item.success === 1;
      let receipt =
        (item.id && (await prisma.receipt.findUnique({ where: { id: String(item.id) } }))) ||
        (item.external_id &&
          (await prisma.receipt.findUnique({ where: { externalId: String(item.external_id) } }))) ||
        (item.externalId &&
          (await prisma.receipt.findUnique({ where: { externalId: String(item.externalId) } }))) ||
        (item.number &&
          (await prisma.receipt.findFirst({
            where: { number: String(item.number), deleted: false },
            orderBy: { createdAt: 'desc' },
          })));

      if (!receipt) continue;

      if (success) {
        await prisma.receipt.update({
          where: { id: receipt.id },
          data: {
            exportedTo1C: true,
            exportedTo1CAt: new Date(),
            syncError: null,
            status: receipt.status === 'sync_error' ? 'completed' : receipt.status,
          },
        });
        await appendReceiptAudit(prisma, {
          receiptId: receipt.id,
          action: 'sync_1c',
          details: { success: true },
        });
      } else {
        await prisma.receipt.update({
          where: { id: receipt.id },
          data: {
            exportedTo1C: false,
            exportedTo1CAt: null,
            status: 'sync_error',
            syncError: String(item.error || item.message || 'Ошибка на стороне 1С'),
          },
        });
        await appendReceiptAudit(prisma, {
          receiptId: receipt.id,
          action: 'sync_error',
          details: item,
        });
      }
    }

    const rows = await prisma.receipt.findMany({
      where: {
        deleted: false,
        exportedTo1C: false,
        status: { in: [...COMPLETED, 'sync_error'] },
      },
      include: {
        receiver: { select: { id: true, name: true, login: true } },
        lines: {
          orderBy: { sortOrder: 'asc' },
          include: {
            expectedCodes: { orderBy: { unitIndex: 'asc' } },
            scannedCodes: { orderBy: { scannedAt: 'asc' } },
          },
        },
        discrepancies: true,
      },
      orderBy: { completedAt: 'asc' },
    });

    const receipts = rows
      .filter((r) => COMPLETED.includes(r.status as any) || r.status === 'sync_error')
      .filter((r) => !r.exportedTo1C)
      .map(buildReceiptExportPayload);

    return NextResponse.json({ success: true, receipts, count: receipts.length });
  } catch (error: unknown) {
    console.error('[API receipts sync-1c]', error);
    return NextResponse.json({ error: 'Ошибка sync-1c' }, { status: 500 });
  }
}
