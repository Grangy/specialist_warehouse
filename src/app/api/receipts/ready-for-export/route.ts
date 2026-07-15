import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';
import { append1cLog } from '@/lib/1cLog';
import { appendReceiptAudit, buildReceiptExportPayload } from '@/lib/receipts';

export const dynamic = 'force-dynamic';

const COMPLETED = ['completed', 'completed_with_discrepancies'] as const;

async function loadReadyForExport() {
  return prisma.receipt.findMany({
    where: {
      deleted: false,
      exportedTo1C: false,
      status: { in: [...COMPLETED] },
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
}

/** GET /api/receipts/ready-for-export — завершённые приёмки для 1С */
export async function GET(request: NextRequest) {
  const authResult = await authenticateRequest(request, {}, ['admin']);
  if (authResult instanceof NextResponse) return authResult;

  const rows = await loadReadyForExport();
  const now = new Date();
  if (rows.length) {
    await prisma.receipt.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { lastSentTo1CAt: now },
    });
  }

  const receipts = rows.map(buildReceiptExportPayload);
  append1cLog({
    ts: now.toISOString(),
    type: 'receipts-ready-for-export',
    direction: 'out',
    endpoint: 'GET /api/receipts/ready-for-export',
    summary: `Отдано приёмок: ${receipts.length}`,
    details: { count: receipts.length, numbers: receipts.map((r) => r.number) },
  });

  return NextResponse.json({ receipts, count: receipts.length });
}
