import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { updateCollectorStats, updateCheckerStats } from '@/lib/ranking/updateStats';

export const dynamic = 'force-dynamic';

type Assignment = {
  taskId: string;
  collectorId?: string | null;
  checkerId?: string | null;
  dictatorId?: string | null;
};

/**
 * POST /api/admin/shipments/[id]/reassign-stats
 * Переназначение сборщика/проверяльщика/диктовщика по заданиям завершённого заказа и пересчёт баллов.
 * Только для администраторов.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { id: shipmentId } = await params;
    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.assignments) ? body.assignments : body.taskAssignments;
    const assignments: Assignment[] = Array.isArray(raw)
      ? raw.filter(
          (a: unknown): a is Assignment =>
            typeof a === 'object' &&
            a != null &&
            typeof (a as Assignment).taskId === 'string'
        )
      : [];

    if (assignments.length === 0) {
      return NextResponse.json(
        { error: 'Укажите assignments: массив { taskId, collectorId?, checkerId?, dictatorId? }' },
        { status: 400 }
      );
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: { tasks: { select: { id: true } } },
    });
    if (!shipment) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    const taskIds = new Set(shipment.tasks.map((t) => t.id));
    for (const a of assignments) {
      if (!taskIds.has(a.taskId)) {
        return NextResponse.json(
          { error: `Задание ${a.taskId} не принадлежит этому заказу` },
          { status: 400 }
        );
      }
    }

    const userIds = new Set<string>();
    for (const a of assignments) {
      if (a.collectorId) userIds.add(a.collectorId);
      if (a.checkerId) userIds.add(a.checkerId);
      if (a.dictatorId) userIds.add(a.dictatorId);
    }
    const users =
      userIds.size > 0
        ? await prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true },
          })
        : [];
    const userByName = Object.fromEntries(users.map((u) => [u.id, u.name]));

    const targetTaskIds = assignments.map((a) => a.taskId);

    // Удалить старые записи TaskStatistics по этим заданиям
    await prisma.taskStatistics.deleteMany({
      where: { taskId: { in: targetTaskIds } },
    });

    for (const a of assignments) {
      const updateData: {
        collectorId?: string | null;
        collectorName?: string | null;
        checkerId?: string | null;
        checkerName?: string | null;
        dictatorId?: string | null;
      } = {};

      if (a.collectorId !== undefined) {
        updateData.collectorId = a.collectorId || null;
        updateData.collectorName = a.collectorId ? (userByName[a.collectorId] ?? null) : null;
      }
      if (a.checkerId !== undefined) {
        updateData.checkerId = a.checkerId || null;
        updateData.checkerName = a.checkerId ? (userByName[a.checkerId] ?? null) : null;
      }
      if (a.dictatorId !== undefined) {
        updateData.dictatorId = a.dictatorId || null;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.shipmentTask.update({
          where: { id: a.taskId },
          data: updateData,
        });
      }
    }

    for (const taskId of targetTaskIds) {
      await updateCollectorStats(taskId);
      await updateCheckerStats(taskId);
    }

    return NextResponse.json({
      ok: true,
      message: 'Баллы пересчитаны',
      taskIds: targetTaskIds,
    });
  } catch (error) {
    console.error('[reassign-stats]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка при пересчёте баллов' },
      { status: 500 }
    );
  }
}
