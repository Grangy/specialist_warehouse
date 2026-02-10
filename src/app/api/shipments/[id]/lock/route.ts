import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { emitShipmentEvent } from '@/lib/sseEvents';
import { touchSync } from '@/lib/syncTouch';

export const dynamic = 'force-dynamic';

const LOCK_TIMEOUT = 30 * 60 * 1000; // 30 минут (максимальное время жизни блокировки)
/** 5 минут без прогресса сборки (startedAt = null) — другой сборщик может перехватить */
const IDLE_NO_PROGRESS_MS = 5 * 60 * 1000;
/** 15 минут с момента последнего действия, если сборка уже начата — другой сборщик может перехватить */
const IDLE_WITH_PROGRESS_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params; // id теперь это taskId
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    let body: { confirmTakeOver?: boolean } = {};
    try {
      const raw = await request.json();
      if (raw && typeof raw === 'object' && 'confirmTakeOver' in raw) {
        body = { confirmTakeOver: Boolean(raw.confirmTakeOver) };
      }
    } catch {
      // body optional
    }

    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: { locks: true },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    const isAdmin = user.role === 'admin';

    // Сборка заданий «Склад 3» разрешена только пользователям с ролью Склад 3 или админу
    if (task.warehouse === 'Склад 3' && user.role !== 'warehouse_3' && !isAdmin) {
      return NextResponse.json(
        {
          error: 'Сборка по Склад 3 доступна только пользователям с ролью «Склад 3».',
          code: 'WAREHOUSE_3_ONLY',
        },
        { status: 403 }
      );
    }

    // Проверяем существующую блокировку
    const existingLock = task.locks[0];
    if (existingLock) {
      // Проверяем, не истекла ли блокировка (максимальное время жизни)
      const lockAge = Date.now() - existingLock.lockedAt.getTime();
      if (lockAge > LOCK_TIMEOUT) {
        await prisma.shipmentTaskLock.delete({
          where: { id: existingLock.id },
        });
      } else if (existingLock.userId !== user.id) {
        // Задание заблокировано другим пользователем
        const now = Date.now();
        const noProgressYet = task.startedAt == null;
        // ВАЖНО: для "сброса с рук" используем НЕ heartbeat, а продвижение:
        // - если сборка не начата (startedAt=null) → 5 минут от lockedAt
        // - если сборка начата → 15 минут от последнего прогресса (task.updatedAt, иначе startedAt)
        const progressAt = (task.updatedAt ?? task.startedAt ?? existingLock.lockedAt).getTime();
        const timeSinceProgress = noProgressYet
          ? now - existingLock.lockedAt.getTime()
          : now - progressAt;
        const idleTimeoutMs = noProgressYet ? IDLE_NO_PROGRESS_MS : IDLE_WITH_PROGRESS_MS;
        const canTakeOverByTimeout = timeSinceProgress >= idleTimeoutMs;

        const lockUser = await prisma.user.findUnique({
          where: { id: existingLock.userId },
          select: { name: true, role: true },
        });
        const lockedByName = lockUser?.name ?? 'другой сборщик';

        if (!canTakeOverByTimeout) {
          // Таймаут ещё не прошёл — перехват только для админа, с подтверждением
          if (!isAdmin) {
            return NextResponse.json(
              {
                error: `Задание собирает ${lockedByName}. Дождитесь завершения или обновите список.`,
                code: 'LOCKED_BY_OTHER',
                lockedByName,
                debug: {
                  rule: noProgressYet ? 'no_progress_5m' : 'no_progress_15m',
                  noProgressYet,
                  timeSinceProgressMs: timeSinceProgress,
                  thresholdMs: idleTimeoutMs,
                  progressAt: noProgressYet ? existingLock.lockedAt.toISOString() : new Date(progressAt).toISOString(),
                },
              },
              { status: 409 }
            );
          }
          // Админ может перехватить только с подтверждением
          if (!body.confirmTakeOver) {
            return NextResponse.json(
              {
                error: `Задание собирает ${lockedByName}. Вы точно уверены, что хотите перехватить?`,
                code: 'CAN_TAKE_OVER',
                lockedByName,
                debug: {
                  rule: noProgressYet ? 'no_progress_5m' : 'no_progress_15m',
                  noProgressYet,
                  timeSinceProgressMs: timeSinceProgress,
                  thresholdMs: idleTimeoutMs,
                  progressAt: noProgressYet ? existingLock.lockedAt.toISOString() : new Date(progressAt).toISOString(),
                },
              },
              { status: 409 }
            );
          }
          emitShipmentEvent('shipment:unlocked', {
            taskId: id,
            shipmentId: task.shipmentId,
            userId: existingLock.userId,
          });
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        } else {
          // Таймаут прошёл — любой сборщик может перехватить, но только с подтверждением
          if (!body.confirmTakeOver) {
            return NextResponse.json(
              {
                error: `Задание долго было без продвижения. Сборку начал: ${lockedByName}. Вы точно уверены, что хотите перехватить?`,
                code: 'CAN_TAKE_OVER',
                lockedByName,
                debug: {
                  rule: noProgressYet ? 'no_progress_5m' : 'no_progress_15m',
                  noProgressYet,
                  timeSinceProgressMs: timeSinceProgress,
                  thresholdMs: idleTimeoutMs,
                  progressAt: noProgressYet ? existingLock.lockedAt.toISOString() : new Date(progressAt).toISOString(),
                },
              },
              { status: 409 }
            );
          }
          emitShipmentEvent('shipment:unlocked', {
            taskId: id,
            shipmentId: task.shipmentId,
            userId: existingLock.userId,
          });
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        }
      } else {
        // Блокировка уже существует и принадлежит текущему пользователю
        await prisma.shipmentTaskLock.update({
          where: { id: existingLock.id },
          data: { lastHeartbeat: new Date() },
        });
        if (task.droppedByCollectorId != null || task.droppedByCollectorName != null) {
          await prisma.shipmentTask.update({
            where: { id },
            data: { droppedByCollectorId: null, droppedByCollectorName: null, droppedAt: null },
          });
        }
        // Проверяем, что collectorId тоже соответствует
        if (task.collectorId && task.collectorId !== user.id) {
          // Это не должно происходить, но на всякий случай проверяем
          console.warn(`[LOCK] Предупреждение: блокировка принадлежит пользователю ${user.id}, но collectorId = ${task.collectorId}`);
        }
        
        emitShipmentEvent('shipment:locked', {
          taskId: id,
          shipmentId: task.shipmentId,
          userId: user.id,
          userName: user.name,
        });
        await touchSync();
        return NextResponse.json({ success: true });
      }
    }

    // Создаем новую блокировку (в т.ч. при перехвате после чужой разблокировки или истекшей блокировки)
    await prisma.shipmentTaskLock.create({
      data: {
        taskId: id,
        userId: user.id,
        lastHeartbeat: new Date(), // Явно устанавливаем для ясности
      },
    });

    // Назначаем задание текущему пользователю; сбрасываем «кто бросил» — задание снова в работе
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        collectorName: user.name,
        collectorId: user.id,
        droppedByCollectorId: null,
        droppedByCollectorName: null,
        droppedAt: null,
      },
    });

    emitShipmentEvent('shipment:locked', {
      taskId: id,
      shipmentId: task.shipmentId,
      userId: user.id,
      userName: user.name,
    });
    await touchSync();

    return NextResponse.json({ 
      success: true,
      collectorName: user.name,
      collectorId: user.id,
    });
  } catch (error) {
    console.error('Ошибка при блокировке заказа:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при блокировке заказа' },
      { status: 500 }
    );
  }
}
