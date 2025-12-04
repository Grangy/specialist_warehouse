/**
 * Логика разбиения заказов на задания по складам
 */

const MAX_ITEMS_PER_TASK = 35; // Максимум 35 наименований (SKU) в одном задании

export interface ShipmentLineInput {
  id?: string;
  sku: string;
  name: string;
  qty: number;
  uom: string;
  location?: string | null;
  warehouse?: string | null;
}

export interface TaskLineInput {
  shipmentLineId: string;
  qty: number;
}

export interface TaskInput {
  warehouse: string;
  lines: TaskLineInput[];
}

/**
 * Разбивает заказ на задания по складам
 * Максимальное количество наименований (SKU) в одном задании = 35
 * 
 * @param lines - Позиции заказа
 * @param maxItemsPerTask - Максимальное количество наименований в одном задании (по умолчанию 35)
 * @returns Массив заданий
 */
export function splitShipmentIntoTasks(
  lines: ShipmentLineInput[],
  maxItemsPerTask: number = MAX_ITEMS_PER_TASK
): TaskInput[] {
  // Группируем позиции по складам
  const warehouseGroups: Record<string, ShipmentLineInput[]> = {};

  for (const line of lines) {
    const warehouse = line.warehouse || 'Склад 1'; // По умолчанию Склад 1
    if (!warehouseGroups[warehouse]) {
      warehouseGroups[warehouse] = [];
    }
    warehouseGroups[warehouse].push(line);
  }

  const tasks: TaskInput[] = [];

  // Для каждого склада создаем задания
  for (const [warehouse, warehouseLines] of Object.entries(warehouseGroups)) {
    let currentTaskLines: TaskLineInput[] = [];

    for (const line of warehouseLines) {
      const lineId = line.id || `temp-${line.sku}`;
      
      // Если текущее задание уже содержит 35 наименований, создаем новое
      if (currentTaskLines.length >= maxItemsPerTask) {
        tasks.push({
          warehouse,
          lines: [...currentTaskLines],
        });
        currentTaskLines = [];
      }

      // Добавляем всю позицию целиком (все количество) в текущее задание
      currentTaskLines.push({
        shipmentLineId: lineId,
        qty: line.qty, // Все количество позиции идет в одно задание
      });
    }

    // Добавляем последнее задание для склада, если оно не пустое
    if (currentTaskLines.length > 0) {
      tasks.push({
        warehouse,
        lines: currentTaskLines,
      });
    }
  }

  return tasks;
}

/**
 * Проверяет, все ли задания заказа подтверждены
 */
export function areAllTasksConfirmed(tasks: Array<{ status: string }>): boolean {
  if (tasks.length === 0) return false;
  return tasks.every((task) => task.status === 'processed');
}

