import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const { id } = params; // id теперь это taskId

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: { locks: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    const lock = task.locks[0];
    if (!lock) {
      return NextResponse.json({ success: true }); // Уже разблокирован
    }

    if (lock.userId !== user.id) {
      return NextResponse.json(
        { success: false, message: 'Задание заблокировано другим пользователем' },
        { status: 403 }
      );
    }

    await prisma.shipmentTaskLock.delete({
      where: { id: lock.id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при разблокировке заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при разблокировке заказа' },
      { status: 500 }
    );
  }
}
