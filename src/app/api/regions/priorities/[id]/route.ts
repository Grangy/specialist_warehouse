import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// DELETE - удалить приоритет региона
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { id } = params;

    await prisma.regionPriority.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении приоритета региона:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при удалении приоритета региона' },
      { status: 500 }
    );
  }
}

