import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/collector-errors
 * Список вызовов кладовщика (ошибки сборщиков) с фильтрами.
 * Параметры: dateFrom, dateTo (YYYY-MM-DD), collectorId, shipmentNumber, status (new|accepted|done|canceled)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const collectorId = searchParams.get('collectorId');
    const shipmentNumber = searchParams.get('shipmentNumber');
    const status = searchParams.get('status');

    const where: Record<string, unknown> = {};

    if (dateFrom) {
      const d = new Date(dateFrom);
      if (!isNaN(d.getTime())) {
        where.calledAt = where.calledAt ?? {};
        (where.calledAt as Record<string, Date>).gte = new Date(d.setHours(0, 0, 0, 0));
      }
    }
    if (dateTo) {
      const d = new Date(dateTo);
      if (!isNaN(d.getTime())) {
        where.calledAt = where.calledAt ?? {};
        (where.calledAt as Record<string, Date>).lte = new Date(d.setHours(23, 59, 59, 999));
      }
    }
    if (collectorId) {
      where.collectorId = collectorId;
    }
    if (status) {
      where.status = status;
    }
    if (shipmentNumber) {
      where.task = {
        shipment: {
          number: { contains: shipmentNumber },
        },
      };
    }

    const calls = await prisma.collectorCall.findMany({
      where,
      orderBy: { calledAt: 'desc' },
      take: 500,
      include: {
        task: {
          include: {
            shipment: { select: { id: true, number: true } },
            lines: {
              orderBy: { id: 'asc' },
              include: {
                shipmentLine: { select: { name: true, sku: true, art: true } },
              },
            },
          },
        },
        collector: { select: { id: true, name: true, login: true } },
        checker: { select: { id: true, name: true, login: true } },
      },
    });

    const items = calls.map((c) => {
      const line = c.task.lines[c.lineIndex];
      return {
        id: c.id,
        taskId: c.taskId,
        shipmentId: c.task.shipment?.id,
        shipmentNumber: c.task.shipment?.number,
        lineIndex: c.lineIndex,
        lineName: line?.shipmentLine?.name ?? `Позиция ${c.lineIndex + 1}`,
        lineSku: line?.shipmentLine?.sku ?? '',
        collectorId: c.collectorId,
        collectorName: c.collector?.name ?? '',
        checkerId: c.checkerId,
        checkerName: c.checker?.name ?? '',
        calledAt: c.calledAt.toISOString(),
        status: c.status,
        errorCount: c.errorCount,
        comment: c.comment,
        confirmedAt: c.confirmedAt?.toISOString() ?? null,
      };
    });

    // Статистика: общее кол-во ошибок и топ ошибающихся сборщиков
    const statsCalls = await prisma.collectorCall.findMany({
      where,
      select: { collectorId: true, errorCount: true },
    });
    const totalErrors = statsCalls.reduce((s, c) => s + (c.errorCount ?? 0), 0);
    const byCollector = new Map<string, { errorCount: number; callsCount: number }>();
    for (const c of statsCalls) {
      const ex = byCollector.get(c.collectorId);
      if (ex) {
        ex.errorCount += c.errorCount ?? 0;
        ex.callsCount += 1;
      } else {
        byCollector.set(c.collectorId, { errorCount: c.errorCount ?? 0, callsCount: 1 });
      }
    }
    const collectorIds = [...byCollector.keys()];
    const users = collectorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: collectorIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const topCollectors = [...byCollector.entries()]
      .map(([id, v]) => ({
        collectorId: id,
        collectorName: nameById.get(id) ?? '—',
        errorCount: v.errorCount,
        callsCount: v.callsCount,
      }))
      .sort((a, b) => b.errorCount - a.errorCount)
      .slice(0, 10);

    return NextResponse.json({
      items,
      stats: {
        totalErrors,
        totalCalls: statsCalls.length,
        topCollectors,
      },
    });
  } catch (error: unknown) {
    console.error('[API admin/collector-errors]', error);
    return NextResponse.json(
      { error: 'Ошибка загрузки ошибок сборщиков' },
      { status: 500 }
    );
  }
}
