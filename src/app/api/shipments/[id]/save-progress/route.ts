import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// Сохранение прогресса сборки в БД
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

    const { id } = params; // taskId
    const body = await request.json();
    const { lines } = body; // Массив { sku, collected_qty }

    // Проверяем, что задание существует и заблокировано текущим пользователем
    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        locks: true,
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    if (!task) {
      return NextResponse.json({ error: 'Задание не найдено' }, { status: 404 });
    }

    // Проверяем блокировку
    const lock = task.locks[0];
    if (!lock || lock.userId !== user.id) {
      return NextResponse.json(
        { error: 'Задание заблокировано другим пользователем или не заблокировано' },
        { status: 403 }
      );
    }

    // Обновляем прогресс сборки для каждой позиции
    if (lines && Array.isArray(lines)) {
      const linesBySku = new Map(lines.map((line: any) => [line.sku, line]));
      
      for (const taskLine of task.lines) {
        const lineData = linesBySku.get(taskLine.shipmentLine.sku);
        if (lineData) {
          // Сохраняем collected_qty только если оно явно передано и не null
          // Если null, значит позиция не собрана - сохраняем null
          const collectedQty = lineData.collected_qty !== undefined 
            ? (lineData.collected_qty !== null ? lineData.collected_qty : null)
            : null;
          
          // ВАЖНО: checked устанавливается в true, если collected_qty > 0
          // Это означает, что товар собран
          const checked = collectedQty !== null && collectedQty > 0;
          
          console.log(`[save-progress] Обновляем позицию ${taskLine.shipmentLine.sku}: collectedQty=${collectedQty}, checked=${checked}`);
          
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { 
              collectedQty,
              checked, // Сохраняем checked в БД!
            },
          });
        }
      }
    }

    // Обновляем информацию о сборщике, если еще не установлена
    if (!task.collectorId || !task.startedAt) {
      await prisma.shipmentTask.update({
        where: { id },
        data: {
          collectorName: user.name,
          collectorId: user.id,
          startedAt: new Date(),
        },
      });
    }

    const updatedTask = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            shipmentLine: true,
          },
        },
      },
    });

    // Подсчитываем прогресс
    const totalItems = updatedTask!.lines.length;
    const collectedItems = updatedTask!.lines.filter(
      (line) => line.collectedQty !== null && line.collectedQty > 0
    ).length;

    return NextResponse.json({
      success: true,
      progress: {
        collected: collectedItems,
        total: totalItems,
      },
    });
  } catch (error) {
    console.error('Ошибка при сохранении прогресса:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сохранении прогресса' },
      { status: 500 }
    );
  }
}

