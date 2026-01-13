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

    // Проверяем, не начал ли уже другой пользователь сборку
    // Это проверяется через collectorId и startedAt
    // Теперь можно перехватывать даже если начал другой пользователь (включая админа)
    if (task.collectorId && task.collectorId !== user.id) {
      const collector = await prisma.user.findUnique({
        where: { id: task.collectorId },
        select: { name: true, role: true },
      });
      
      console.log(`[LOCK] Задание ${id} уже начато пользователем ${collector?.name || task.collectorId}${collector?.role === 'admin' ? ' (админ)' : ''}, текущий пользователь: ${user.id} (${user.name}). Разрешаем перехват.`);
    }

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
        // Проверяем активность блокировки через heartbeat
        const now = Date.now();
        const lastHeartbeatTime = existingLock.lastHeartbeat.getTime();
        const timeSinceHeartbeat = now - lastHeartbeatTime;
        const isActive = timeSinceHeartbeat < HEARTBEAT_TIMEOUT;
        
        if (isActive) {
          // Блокировка активна (попап открыт) - можно перехватить (включая админа)
          const lockUser = await prisma.user.findUnique({
            where: { id: existingLock.userId },
            select: { name: true, role: true },
          });
          
          console.log(`[LOCK] Блокировка задания ${id} активна (heartbeat: ${timeSinceHeartbeat}ms назад). Пользователь ${user.name} (${user.id}) перехватывает сборку у ${lockUser?.name || existingLock.userId}${lockUser?.role === 'admin' ? ' (админ)' : ''}`);
          
          // Отправляем SSE событие о разблокировке перед удалением (модал закрыт другим пользователем)
          emitShipmentEvent('shipment:unlocked', {
            taskId: id,
            shipmentId: task.shipmentId,
            userId: existingLock.userId,
          });
          
          // Удаляем активную блокировку - теперь можно перехватывать даже активные блокировки
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        } else {
          // Блокировка неактивна (попап закрыт или пользователь вышел) - можно перехватить
          const lockUser = await prisma.user.findUnique({
            where: { id: existingLock.userId },
            select: { name: true },
          });
          
          console.log(`[LOCK] Блокировка задания ${id} неактивна (heartbeat: ${timeSinceHeartbeat}ms назад, таймаут: ${HEARTBEAT_TIMEOUT}ms). Пользователь ${user.name} (${user.id}) перехватывает сборку у ${lockUser?.name || existingLock.userId}`);
          
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

    // Создаем новую блокировку (lastHeartbeat устанавливается автоматически через @default(now()))
    await prisma.shipmentTaskLock.create({
      data: {
        taskId: id,
        userId: user.id,
        lastHeartbeat: new Date(), // Явно устанавливаем для ясности
      },
    });

    // Обновляем задание: сохраняем имя сборщика, ID и время начала сборки
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
