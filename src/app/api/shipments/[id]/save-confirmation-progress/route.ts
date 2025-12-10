import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// Сохранение прогресса проверки в БД (отдельно от прогресса сборки)
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

    // Проверяем роль - только проверяльщик и админ могут сохранять прогресс проверки
    if (user.role !== 'admin' && user.role !== 'checker') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const { id } = params; // taskId
    const body = await request.json();
    const { lines } = body; // Массив { sku, confirmed_qty }

    // Проверяем, что задание существует
    const task = await prisma.shipmentTask.findUnique({
      where: { id },
      include: {
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

    // Проверяем, что задание в статусе pending_confirmation
    if (task.status !== 'pending_confirmation') {
      return NextResponse.json(
        { error: 'Задание не находится в статусе ожидания подтверждения' },
        { status: 400 }
      );
    }

    // Обновляем прогресс проверки для каждой позиции
    if (lines && Array.isArray(lines)) {
      const linesBySku = new Map(lines.map((line: any) => [line.sku, line]));
      
      for (const taskLine of task.lines) {
        const lineData = linesBySku.get(taskLine.shipmentLine.sku);
        if (lineData) {
          // Сохраняем confirmed_qty только если оно явно передано и не null
          // Если null, значит позиция не подтверждена - сохраняем null
          const confirmedQty = lineData.confirmed_qty !== undefined 
            ? (lineData.confirmed_qty !== null ? lineData.confirmed_qty : null)
            : taskLine.confirmedQty; // Если не передано, оставляем текущее значение из БД
          
          // ВАЖНО: confirmed устанавливается явно из данных или остается текущим значением
          // НЕ устанавливаем confirmed автоматически на основе confirmedQty!
          const confirmed = lineData.confirmed !== undefined 
            ? lineData.confirmed 
            : taskLine.confirmed; // Если не передано, оставляем текущее значение из БД
          
          console.log(`[save-confirmation-progress] Обновляем позицию ${taskLine.shipmentLine.sku}: confirmedQty=${confirmedQty}, confirmed=${confirmed}`);
          
          await prisma.shipmentTaskLine.update({
            where: { id: taskLine.id },
            data: { 
              confirmedQty, // Сохраняем confirmedQty (отдельно от collectedQty)
              confirmed, // Сохраняем confirmed (отдельно от checked)
            },
          });
        }
      }
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

    // Подсчитываем прогресс проверки
    const totalItems = updatedTask!.lines.length;
    const confirmedItems = updatedTask!.lines.filter(
      (line) => line.confirmedQty !== null && line.confirmedQty > 0
    ).length;

    return NextResponse.json({
      success: true,
      progress: {
        confirmed: confirmedItems,
        total: totalItems,
      },
    });
  } catch (error) {
    console.error('Ошибка при сохранении прогресса проверки:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сохранении прогресса проверки' },
      { status: 500 }
    );
  }
}

