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

    // Проверяем, не начал ли уже другой пользователь сборку
    // Это проверяется через collectorId и startedAt
    if (task.collectorId && task.collectorId !== user.id) {
      // Сборку начал другой пользователь
      // Только админ может вмешаться
      console.log(`[LOCK] Задание ${id} уже начато пользователем ${task.collectorId}, текущий пользователь: ${user.id} (${user.name}), роль: ${user.role}`);
      
      if (user.role !== 'admin') {
        const collector = await prisma.user.findUnique({
          where: { id: task.collectorId },
          select: { name: true },
        });
        
        console.log(`[LOCK] Отказ в блокировке: пользователь ${user.name} (${user.role}) пытается заблокировать задание, начатое ${collector?.name || task.collectorId}`);
        
        return NextResponse.json(
          { 
            success: false, 
            message: `Задание уже начато другим сборщиком${collector ? `: ${collector.name}` : ''}. Только администратор может вмешаться в сборку.` 
          },
          { status: 409 }
        );
      } else {
        // Админ может вмешаться - сбрасываем collectorId и startedAt
        const collector = await prisma.user.findUnique({
          where: { id: task.collectorId },
          select: { name: true },
        });
        
        console.log(`[LOCK] Админ ${user.name} (${user.id}) вмешивается в сборку задания ${id}, начатую пользователем ${collector?.name || task.collectorId}`);
      }
    }

    // Проверяем существующую блокировку
    const existingLock = task.locks[0];
    if (existingLock) {
      // Проверяем, не истекла ли блокировка
      const lockAge = Date.now() - existingLock.lockedAt.getTime();
      if (lockAge > LOCK_TIMEOUT) {
        // Удаляем истекшую блокировку
        // Но если collectorId установлен и не соответствует текущему пользователю,
        // это уже проверено выше, так что просто удаляем блокировку
        await prisma.shipmentTaskLock.delete({
          where: { id: existingLock.id },
        });
      } else if (existingLock.userId !== user.id) {
        // Задание заблокировано другим пользователем
        // Только админ может вмешаться в сборку другого пользователя
        if (user.role !== 'admin') {
          // Получаем информацию о пользователе, который заблокировал
          const lockUser = await prisma.user.findUnique({
            where: { id: existingLock.userId },
            select: { name: true },
          });
          
          return NextResponse.json(
            { 
              success: false, 
              message: `Задание уже начато другим сборщиком${lockUser ? `: ${lockUser.name}` : ''}. Только администратор может вмешаться в сборку.` 
            },
            { status: 409 }
          );
        } else {
          // Админ может вмешаться - удаляем старую блокировку и создаем новую
          const lockUser = await prisma.user.findUnique({
            where: { id: existingLock.userId },
            select: { name: true },
          });
          
          console.log(`[LOCK] Админ ${user.name} (${user.id}) вмешивается в сборку задания ${id}, заблокированного пользователем ${lockUser?.name || existingLock.userId}`);
          
          await prisma.shipmentTaskLock.delete({
            where: { id: existingLock.id },
          });
        }
      } else {
        // Блокировка уже существует и принадлежит текущему пользователю
        // Проверяем, что collectorId тоже соответствует
        if (task.collectorId && task.collectorId !== user.id) {
          // Это не должно происходить, но на всякий случай проверяем
          console.warn(`[LOCK] Предупреждение: блокировка принадлежит пользователю ${user.id}, но collectorId = ${task.collectorId}`);
        }
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

    // Обновляем задание: сохраняем имя сборщика, ID и время начала сборки
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        collectorName: user.name,
        collectorId: user.id,
        startedAt: new Date(),
      },
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
