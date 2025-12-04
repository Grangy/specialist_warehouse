import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

const LOCK_TIMEOUT = 30 * 60 * 1000; // 30 минут

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

    // Проверяем существующую блокировку
    const existingLock = task.locks[0];
    if (existingLock) {
      // Проверяем, не истекла ли блокировка
      const lockAge = Date.now() - existingLock.lockedAt.getTime();
      if (lockAge > LOCK_TIMEOUT) {
        // Удаляем истекшую блокировку
        await prisma.shipmentTaskLock.delete({
          where: { id: existingLock.id },
        });
      } else if (existingLock.userId !== user.id) {
        return NextResponse.json(
          { success: false, message: 'Задание уже заблокировано другим пользователем' },
          { status: 409 }
        );
      } else {
        // Блокировка уже существует и принадлежит текущему пользователю
        return NextResponse.json({ success: true });
      }
    }

    // Создаем новую блокировку
    await prisma.shipmentTaskLock.create({
      data: {
        taskId: id,
        userId: user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при блокировке заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при блокировке заказа' },
      { status: 500 }
    );
  }
}
