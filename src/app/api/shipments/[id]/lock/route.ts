import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { emitShipmentEvent } from '@/lib/sseEvents';

export const dynamic = 'force-dynamic';

const LOCK_TIMEOUT = 30 * 60 * 1000; // 30 минут (максимальное время жизни блокировки)
const HEARTBEAT_TIMEOUT = 30 * 1000; // 30 секунд (таймаут активности)

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

    const isAdmin = user.role === 'admin';

    // Проверяем существующую блокировку
    const existingLock = task.locks[0];
    if (existingLock) {
      // Проверяем, не истекла ли блокировка (максимальное время жизни)
      const lockAge = Date.now() - existingLock.lockedAt.getTime();
      if (lockAge > LOCK_TIMEOUT) {
        // Удаляем истекшую блокировку
        console.log(`[LOCK] Блокировка задания ${id} истекла (возраст: ${lockAge}ms), удаляем`);
        await prisma.shipmentTaskLock.delete({
          where: { id: existingLock.id },
        });
      } else if (existingLock.userId !== user.id) {
        // Задание заблокировано другим пользователем
        const now = Date.now();
        const lastHeartbeatTime = existingLock.lastHeartbeat.getTime();
        const timeSinceHeartbeat = now - lastHeartbeatTime;
        const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;

        const lockUser = await prisma.user.findUnique({
          where: { id: existingLock.userId },
          select: { name: true, role: true },
        });
        const lockedByName = lockUser?.name ?? 'другой сборщик';

        if (isActive) {
          // Блокировка активна (попап открыт у другого) — перехват только для админа
          if (!isAdmin) {
            console.log(`[LOCK] Задание ${id} активно собирает ${lockedByName}, пользователь ${user.name} получил отказ (только 1 сборщик)`);
            return NextResponse.json(
              {
                error: `Задание собирает ${lockedByName}. Дождитесь завершения или обновите список.`,
                code: 'LOCKED_BY_OTHER',
                lockedByName,
              },
              { status: 409 }
            );
          }
          // Админ может перехватить
          console.log(`[LOCK] Блокировка задания ${id} активна. Админ ${user.name} перехватывает сборку у ${lockedByName}`);
          emitShipmentEvent('shipment:unlocked', {
            taskId: id,
            shipmentId: task.shipmentId,
            userId: existingLock.userId,
          });
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        } else {
          // Блокировка неактивна (попап закрыт или пользователь вышел) — можно перехватить
          console.log(`[LOCK] Блокировка задания ${id} неактивна (heartbeat: ${timeSinceHeartbeat}ms назад, таймаут: ${HEARTBEAT_TIMEOUT}ms). Пользователь ${user.name} (${user.id}) перехватывает сборку у ${lockedByName}`);
          
          // Отправляем SSE событие о разблокировке перед удалением (модал закрыт)
          emitShipmentEvent('shipment:unlocked', {
            taskId: id,
            shipmentId: task.shipmentId,
            userId: existingLock.userId,
          });
          
          // Удаляем неактивную блокировку
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        }
      } else {
        // Блокировка уже существует и принадлежит текущему пользователю
        // Обновляем heartbeat и возвращаем успех
        await prisma.shipmentTaskLock.update({
          where: { id: existingLock.id },
          data: {
            lastHeartbeat: new Date(),
          },
        });
        
        // Проверяем, что collectorId тоже соответствует
        if (task.collectorId && task.collectorId !== user.id) {
          // Это не должно происходить, но на всякий случай проверяем
          console.warn(`[LOCK] Предупреждение: блокировка принадлежит пользователю ${user.id}, но collectorId = ${task.collectorId}`);
        }
        
        // Отправляем SSE событие о блокировке (модал все еще открыт)
        emitShipmentEvent('shipment:locked', {
          taskId: id,
          shipmentId: task.shipmentId,
          userId: user.id,
          userName: user.name,
        });
        
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

    // Назначаем задание текущему пользователю: статистика и сборка зачисляются тому, кто взял/перехватил задание
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        collectorName: user.name,
        collectorId: user.id,
        startedAt: new Date(),
      },
    });

    // Отправляем SSE событие о блокировке задания (модал открыт)
    emitShipmentEvent('shipment:locked', {
      taskId: id,
      shipmentId: task.shipmentId,
      userId: user.id,
      userName: user.name,
    });

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
