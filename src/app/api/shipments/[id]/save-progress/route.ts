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
    // Защита от двух сборщиков: только назначенный сборщик может сохранять прогресс
    if (task.collectorId != null && task.collectorId !== user.id) {
      return NextResponse.json(
        { error: 'Задание собирает другой сборщик. Обновите список.', code: 'TAKEN_BY_OTHER' },
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

    // Явная фиксация «прогресса» сборки:
    // - startedAt ставим при первом сохранении прогресса (если ещё не было)
    // - updatedAt обновляем КАЖДЫЙ раз при save-progress (это "последнее продвижение", не heartbeat)
    const progressNow = new Date();
    await prisma.shipmentTask.update({
      where: { id },
      data: {
        collectorName: user.name,
        collectorId: user.id,
        startedAt: task.startedAt ? undefined : progressNow,
        updatedAt: progressNow,
      },
    });

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

