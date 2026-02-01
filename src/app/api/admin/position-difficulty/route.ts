import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

/** Минимум сборок для отображения позиции в отчёте (калибровка). */
const MIN_PICKINGS = 10;

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (user.role !== 'admin' && user.role !== 'checker') {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('mode') ?? 'hard'; // hard | easy
    const warehouse = searchParams.get('warehouse') ?? undefined; // optional filter

    const where: { taskCount: { gte: number }; warehouse?: string } = {
      taskCount: { gte: MIN_PICKINGS },
    };
    if (warehouse) where.warehouse = warehouse;

    const rows = await prisma.positionDifficulty.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    });

    const items = rows.map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      warehouse: r.warehouse,
      taskCount: r.taskCount,
      totalUnits: r.totalUnits,
      avgMultiplicity: r.taskCount > 0 ? r.totalUnits / r.taskCount : 0,
      avgSecPerUnit: r.taskCount > 0 ? r.sumSecPerUnit / r.taskCount : 0,
      avgSecPerPos: r.taskCount > 0 ? r.sumSecPerPos / r.taskCount : 0,
      updatedAt: r.updatedAt.toISOString(),
    }));

    if (mode === 'easy') {
      items.sort((a, b) => a.avgSecPerUnit - b.avgSecPerUnit);
    } else {
      items.sort((a, b) => b.avgSecPerUnit - a.avgSecPerUnit);
    }

    return NextResponse.json({
      mode,
      minPickings: MIN_PICKINGS,
      items,
    });
  } catch (error) {
    console.error('[position-difficulty]', error);
    return NextResponse.json(
      { error: 'Ошибка при загрузке сложности позиций' },
      { status: 500 }
    );
  }
}
