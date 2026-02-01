import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { touchSync } from '@/lib/syncTouch';

export const dynamic = 'force-dynamic';

// Сохранение прогресса сборки в БД
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
          // ВАЖНО: collected_qty может быть 0 (нулевая позиция) - это валидное значение!
          // null означает, что количество еще не установлено
          // 0 означает, что установлено явно 0 предметов
          const collectedQty = lineData.collected_qty !== undefined 
            ? (lineData.collected_qty !== null ? lineData.collected_qty : null)
            : null;
          
          // ВАЖНО: checked должен передаваться ЯВНО из фронтенда
          // НЕ устанавливаем checked автоматически на основе collected_qty
          // Это предотвращает баг, когда при редактировании одной позиции все остальные помечаются как собранные
          const checked = lineData.checked !== undefined 
            ? lineData.checked 
            : (collectedQty !== null && collectedQty > 0 ? taskLine.checked : false); // Сохраняем текущее значение, если не передано
          
          // Аудит: логируем нулевые позиции
          if (collectedQty === 0) {
            console.log(`[save-progress] АУДИТ: Сохраняем нулевую позицию ${taskLine.shipmentLine.sku}: collectedQty=0, checked=${checked} (явно передано: ${lineData.checked !== undefined})`);
          }
          
          console.log(`[save-progress] Обновляем позицию ${taskLine.shipmentLine.sku}: collectedQty=${collectedQty}, checked=${checked} (явно передано: ${lineData.checked !== undefined})`);
          
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

    await touchSync();

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

