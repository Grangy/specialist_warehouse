import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/1c-warnings
 *
 * Заказы, которые были отданы 1С в ответе на запрос (ready-for-export),
 * но 1С не вернул их как успешно принятые (sync-1c с success: true).
 * Условие: status=processed, deleted=false, lastSentTo1CAt != null, exportedTo1C=false.
 *
 * Ответ: { count, shipments } — для счётчика в меню и списка во вкладке «Предупреждения».
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const warnings = await prisma.shipment.findMany({
      where: {
        status: 'processed',
        deleted: false,
        lastSentTo1CAt: { not: null },
        exportedTo1C: false,
      },
      include: {
        tasks: {
          include: {
            collector: { select: { id: true, name: true, login: true } },
            checker: { select: { id: true, name: true, login: true } },
            dictator: { select: { id: true, name: true, login: true } },
          },
        },
      },
      orderBy: { lastSentTo1CAt: 'desc' },
    });

    const collectors = (shipment: (typeof warnings)[0]) =>
      shipment.tasks
        .filter((t) => t.collectorName)
        .map((t) => t.collectorName!)
        .filter((name, i, arr) => arr.indexOf(name) === i);
    const checkers = (shipment: (typeof warnings)[0]) =>
      shipment.tasks
        .filter((t) => t.checkerName)
        .map((t) => t.checkerName!)
        .filter((name, i, arr) => arr.indexOf(name) === i);
    const dictators = (shipment: (typeof warnings)[0]) =>
      shipment.tasks
        .filter((t) => t.dictator?.name)
        .map((t) => t.dictator!.name)
        .filter((name, i, arr) => arr.indexOf(name) === i);

    const shipments = warnings.map((s) => ({
      id: s.id,
      shipment_id: s.id,
      shipment_number: s.number,
      number: s.number,
      created_at: s.createdAt.toISOString(),
      customer_name: s.customerName,
      destination: s.destination,
      items_count: s.itemsCount,
      total_qty: s.totalQty,
      weight: s.weight,
      comment: s.comment,
      status: s.status,
      business_region: s.businessRegion,
      collector_name: collectors(s).length ? collectors(s).join(', ') : null,
      collectors: collectors(s),
      checker_name: checkers(s).length ? checkers(s).join(', ') : null,
      checkers: checkers(s),
      dictator_name: dictators(s).length ? dictators(s).join(', ') : null,
      dictators: dictators(s),
      confirmed_at: s.confirmedAt?.toISOString() ?? null,
      tasks_count: s.tasks.length,
      warehouses: [...new Set(s.tasks.map((t) => t.warehouse))],
      exported_to_1c: s.exportedTo1C,
      exported_to_1c_at: s.exportedTo1CAt?.toISOString() ?? null,
      last_sent_to_1c_at: s.lastSentTo1CAt?.toISOString() ?? null,
    }));

    return NextResponse.json({ count: shipments.length, shipments });
  } catch (error: unknown) {
    console.error('[API admin/1c-warnings]', error);
    return NextResponse.json(
      { error: 'Ошибка загрузки предупреждений 1С' },
      { status: 500 }
    );
  }
}
