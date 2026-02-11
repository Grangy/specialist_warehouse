import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * DELETE /api/admin/collector-errors/[id]
 * Удаление записи об ошибке сборщика (только для админа).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Укажите id записи.' }, { status: 400 });
    }

    await prisma.collectorCall.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
      return NextResponse.json({ error: 'Запись не найдена.' }, { status: 404 });
    }
    console.error('[API admin/collector-errors DELETE]', error);
    return NextResponse.json(
      { error: 'Ошибка при удалении записи.' },
      { status: 500 }
    );
  }
}
