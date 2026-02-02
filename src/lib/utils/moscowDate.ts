/**
 * Границы периодов для статистики в часовом поясе Москвы (UTC+3).
 * Сервер может работать в UTC — даты считаем по Москве, чтобы рейтинги не были пустыми.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

function getMoscowDateParts(utcNow: Date): { year: number; month: number; date: number; dayOfWeek: number } {
  const moscowTime = new Date(utcNow.getTime() + MSK_OFFSET_MS);
  return {
    year: moscowTime.getUTCFullYear(),
    month: moscowTime.getUTCMonth(),
    date: moscowTime.getUTCDate(),
    dayOfWeek: moscowTime.getUTCDay(),
  };
}

/** Начало дня по Москве в UTC (00:00 МСК = предыдущий день 21:00 UTC). */
function startOfDayMoscowUTC(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month, date) - MSK_OFFSET_MS);
}

/** Конец дня по Москве в UTC (23:59:59.999 МСК). */
function endOfDayMoscowUTC(year: number, month: number, date: number): Date {
  return new Date(Date.UTC(year, month, date) + 24 * 60 * 60 * 1000 - MSK_OFFSET_MS - 1);
}

export interface StatisticsDateRange {
  startDate: Date;
  endDate: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Возвращает границы периода для статистики в московском времени.
 * startDate/endDate — в UTC, для сравнения с completedAt/confirmedAt в БД.
 * - today: текущий день по Москве
 * - week: последние 7 дней (сегодня −7 дней .. конец сегодня)
 * - month: последние 30 дней (сегодня −30 дней .. конец сегодня)
 */
export function getStatisticsDateRange(period: 'today' | 'week' | 'month'): StatisticsDateRange {
  const now = new Date();
  const m = getMoscowDateParts(now);
  const todayStart = startOfDayMoscowUTC(m.year, m.month, m.date);
  const todayEnd = endOfDayMoscowUTC(m.year, m.month, m.date);

  if (period === 'today') {
    return { startDate: todayStart, endDate: todayEnd };
  }

  if (period === 'week') {
    return {
      startDate: new Date(todayStart.getTime() - 7 * DAY_MS),
      endDate: todayEnd,
    };
  }

  if (period === 'month') {
    return {
      startDate: new Date(todayStart.getTime() - 30 * DAY_MS),
      endDate: todayEnd,
    };
  }

  return { startDate: todayStart, endDate: todayEnd };
}

/**
 * Для overview: «сегодня» по Москве (начало дня) — для фильтра DailyStats.date >= today.
 */
export function getMoscowTodayStart(): Date {
  const now = new Date();
  const m = getMoscowDateParts(now);
  return startOfDayMoscowUTC(m.year, m.month, m.date);
}

/**
 * Для overview: начало недели по Москве (понедельник).
 */
export function getMoscowWeekStart(): Date {
  const now = new Date();
  const m = getMoscowDateParts(now);
  const diff = m.date - m.dayOfWeek + (m.dayOfWeek === 0 ? -6 : 1);
  let startDate = diff;
  let startMonth = m.month;
  let startYear = m.year;
  if (startDate < 1) {
    const prevMonth = new Date(Date.UTC(m.year, m.month, 0));
    startDate += prevMonth.getUTCDate();
    startMonth = prevMonth.getUTCMonth();
    startYear = prevMonth.getUTCFullYear();
  }
  return startOfDayMoscowUTC(startYear, startMonth, startDate);
}

/**
 * Для overview: год и месяц по Москве (текущие).
 */
export function getMoscowYearMonth(): { year: number; month: number } {
  const now = new Date();
  const m = getMoscowDateParts(now);
  return { year: m.year, month: m.month + 1 };
}

/** Текущая дата по Москве в формате YYYY-MM-DD (для временных регионов). */
export function getMoscowDateString(utcNow: Date = new Date()): string {
  const m = getMoscowDateParts(utcNow);
  const y = m.year;
  const month = String(m.month + 1).padStart(2, '0');
  const date = String(m.date).padStart(2, '0');
  return `${y}-${month}-${date}`;
}

/** Текущий час по Москве (0–23). */
export function getMoscowHour(utcNow: Date = new Date()): number {
  const moscowTime = new Date(utcNow.getTime() + MSK_OFFSET_MS);
  return moscowTime.getUTCHours();
}

/** Временные регионы действуют до 21:00 МСК. После 21:00 «сегодня» для них закончилось. */
export function isBeforeEndOfWorkingDay(utcNow: Date = new Date()): boolean {
  return getMoscowHour(utcNow) < 21;
}
