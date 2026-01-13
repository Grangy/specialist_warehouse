/**
 * Функции для расчета статистики и баллов системы рангов
 */

interface TaskData {
  taskId: string;
  userId: string;
  shipmentId: string;
  warehouse: string;
  startedAt: Date | null;
  completedAt: Date | null;
  positions: number;
  units: number;
}

interface ShipmentData {
  shipmentId: string;
  createdAt: Date;
  confirmedAt: Date | null;
  warehousesCount: number;
  tasks: TaskData[];
}

interface NormData {
  normA: number; // Норматив секунд на 1 позицию
  normB: number; // Норматив секунд на 1 единицу
  normC: number; // Штраф за переключение склада
  coefficientK: number; // Коэффициент для units (обычно 0.2-0.4)
  coefficientM: number; // Коэффициент для switches (обычно 2-5)
}

/**
 * Расчет метрик времени для задания
 */
export function calculateTaskTimeMetrics(task: TaskData): {
  taskTimeSec: number;
  pickTimeSec: number | null;
} {
  if (!task.startedAt || !task.completedAt) {
    return { taskTimeSec: 0, pickTimeSec: null };
  }

  const taskTimeSec = (task.completedAt.getTime() - task.startedAt.getTime()) / 1000;
  const pickTimeSec = taskTimeSec; // Для одного задания pick_time = task_time

  return { taskTimeSec, pickTimeSec };
}

/**
 * Расчет метрик времени для заказа
 */
export function calculateOrderTimeMetrics(shipment: ShipmentData): {
  pickTimeSec: number;
  elapsedTimeSec: number;
  gapTimeSec: number;
} {
  const tasksWithTime = shipment.tasks.filter(
    (t) => t.startedAt && t.completedAt
  );

  if (tasksWithTime.length === 0) {
    return { pickTimeSec: 0, elapsedTimeSec: 0, gapTimeSec: 0 };
  }

  // pick_time_sec = Σ task_time_sec
  const pickTimeSec = tasksWithTime.reduce((sum, task) => {
    const { taskTimeSec } = calculateTaskTimeMetrics(task);
    return sum + taskTimeSec;
  }, 0);

  // elapsed_time_sec = max(task_end) - min(task_start)
  const startTimes = tasksWithTime.map((t) => t.startedAt!.getTime());
  const endTimes = tasksWithTime.map((t) => t.completedAt!.getTime());
  const minStart = Math.min(...startTimes);
  const maxEnd = Math.max(...endTimes);
  const elapsedTimeSec = (maxEnd - minStart) / 1000;

  // gap_time_sec = elapsed_time_sec - pick_time_sec
  const gapTimeSec = Math.max(0, elapsedTimeSec - pickTimeSec);

  return { pickTimeSec, elapsedTimeSec, gapTimeSec };
}

/**
 * Расчет метрик скорости
 */
export function calculateSpeedMetrics(
  positions: number,
  units: number,
  pickTimeSec: number
): {
  pph: number;
  uph: number;
  secPerPos: number;
  secPerUnit: number;
  unitsPerPos: number;
} {
  if (pickTimeSec <= 0) {
    return {
      pph: 0,
      uph: 0,
      secPerPos: 0,
      secPerUnit: 0,
      unitsPerPos: units / positions || 0,
    };
  }

  const pph = (positions * 3600) / pickTimeSec;
  const uph = (units * 3600) / pickTimeSec;
  const secPerPos = pickTimeSec / positions;
  const secPerUnit = pickTimeSec / units;
  const unitsPerPos = units / positions;

  return { pph, uph, secPerPos, secPerUnit, unitsPerPos };
}

/**
 * Расчет ожидаемого времени (нормативная модель)
 */
export function calculateExpectedTime(
  positions: number,
  units: number,
  switches: number,
  norm: NormData
): number {
  return norm.normA * positions + norm.normB * units + norm.normC * switches;
}

/**
 * Расчет эффективности
 */
export function calculateEfficiency(
  expectedTimeSec: number,
  pickTimeSec: number
): {
  efficiency: number;
  efficiencyClamped: number;
} {
  if (pickTimeSec <= 0) {
    return { efficiency: 1, efficiencyClamped: 1 };
  }

  const efficiency = expectedTimeSec / pickTimeSec;
  // Ограничение: clamp(eff, 0.5, 1.5)
  const efficiencyClamped = Math.max(0.5, Math.min(1.5, efficiency));

  return { efficiency, efficiencyClamped };
}

/**
 * Расчет очков за заказ
 */
export function calculateOrderPoints(
  positions: number,
  units: number,
  switches: number,
  efficiencyClamped: number,
  norm: NormData
): {
  basePoints: number;
  orderPoints: number;
} {
  // base_points = positions + K*units + M*switches
  const basePoints = positions + norm.coefficientK * units + norm.coefficientM * switches;

  // order_points = base_points * eff_clamped
  const orderPoints = basePoints * efficiencyClamped;

  return { basePoints, orderPoints };
}

/**
 * Полный расчет статистики для задания
 */
export function calculateTaskStatistics(
  task: TaskData,
  shipment: ShipmentData,
  norm: NormData
): {
  taskTimeSec: number;
  pickTimeSec: number | null;
  elapsedTimeSec: number;
  gapTimeSec: number;
  pph: number | null;
  uph: number | null;
  secPerPos: number | null;
  secPerUnit: number | null;
  unitsPerPos: number;
  switches: number;
  density: number;
  expectedTimeSec: number;
  efficiency: number | null;
  efficiencyClamped: number | null;
  basePoints: number | null;
  orderPoints: number | null;
} {
  const { taskTimeSec, pickTimeSec } = calculateTaskTimeMetrics(task);
  const orderMetrics = calculateOrderTimeMetrics(shipment);

  const switches = shipment.warehousesCount - 1;
  const unitsPerPos = task.units / task.positions || 0;

  let speedMetrics: {
    pph: number | null;
    uph: number | null;
    secPerPos: number | null;
    secPerUnit: number | null;
    unitsPerPos: number;
  } = { pph: null, uph: null, secPerPos: null, secPerUnit: null, unitsPerPos };
  let expectedTimeSec = 0;
  let efficiency: number | null = null;
  let efficiencyClamped: number | null = null;
  let basePoints: number | null = null;
  let orderPoints: number | null = null;

  if (pickTimeSec !== null && pickTimeSec > 0) {
    speedMetrics = calculateSpeedMetrics(task.positions, task.units, pickTimeSec);
    expectedTimeSec = calculateExpectedTime(task.positions, task.units, switches, norm);
    const eff = calculateEfficiency(expectedTimeSec, pickTimeSec);
    efficiency = eff.efficiency;
    efficiencyClamped = eff.efficiencyClamped;
    const points = calculateOrderPoints(
      task.positions,
      task.units,
      switches,
      efficiencyClamped,
      norm
    );
    basePoints = points.basePoints;
    orderPoints = points.orderPoints;
  }

  return {
    taskTimeSec,
    pickTimeSec,
    elapsedTimeSec: orderMetrics.elapsedTimeSec,
    gapTimeSec: orderMetrics.gapTimeSec,
    ...speedMetrics,
    switches,
    density: unitsPerPos,
    expectedTimeSec,
    efficiency,
    efficiencyClamped,
    basePoints,
    orderPoints,
  };
}

/**
 * Расчет ранга по перцентилям
 */
export function calculateRankByPercentiles(
  value: number,
  percentiles: number[]
): number {
  // percentiles должны быть отсортированы по возрастанию
  // Возвращает ранг от 1 до 10
  for (let i = 0; i < percentiles.length; i++) {
    if (value <= percentiles[i]) {
      return i + 1;
    }
  }
  return 10; // Если значение больше всех перцентилей
}
