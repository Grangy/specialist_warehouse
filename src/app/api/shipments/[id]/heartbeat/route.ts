import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// Таймаут активности: если heartbeat не обновлялся более 30 секунд, блокировка считается неактивной
const HEARTBEAT_TIMEOUT = 30 * 1000; // 30 секунд

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // taskId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: { locks: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    const lock = task.locks[0];
    if (!lock) {
      return NextResponse.json({ error: 'Блокировка не найдена' }, { status: 404 });
    }

    // Проверяем, что блокировка принадлежит текущему пользователю
    if (lock.userId !== user.id) {
      const lockUser = await prisma.user.findUnique({
        where: { id: lock.userId },
        select: { name: true },
      });
      return NextResponse.json(
        {
          error: 'Блокировка принадлежит другому пользователю',
          code: 'LOCKED_BY_OTHER',
          lockedByUserId: lock.userId,
          lockedByName: lockUser?.name ?? 'другой сборщик',
        },
        { status: 403 }
      );
    }

    // Обновляем lastHeartbeat (updateMany: если блокировку уже сняли — нет P2025, только count=0)
    const updated = await prisma.shipmentTaskLock.updateMany({
      where: { id: lock.id, userId: user.id },
      data: {
        lastHeartbeat: new Date(),
      },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        { error: 'Блокировка уже снята', code: 'LOCK_GONE' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при обновлении heartbeat:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении heartbeat' },
      { status: 500 }
    );
  }
}

// GET endpoint для проверки активности блокировки
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // taskId

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: { locks: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    const lock = task.locks[0];
    if (!lock) {
      return NextResponse.json({ 
        active: false,
        message: 'Блокировка не найдена'
      });
    }

    // Проверяем, активна ли блокировка (heartbeat не старше HEARTBEAT_TIMEOUT)
    const now = Date.now();
    const lastHeartbeatTime = lock.lastHeartbeat.getTime();
    const timeSinceHeartbeat = now - lastHeartbeatTime;
    const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;

    return NextResponse.json({
      active: isActive,
      lastHeartbeat: lock.lastHeartbeat.toISOString(),
      timeSinceHeartbeat,
      timeout: HEARTBEAT_TIMEOUT,
    });
  } catch (error) {
    console.error('Ошибка при проверке активности блокировки:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при проверке активности' },
      { status: 500 }
    );
  }
}

