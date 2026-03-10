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

/**
 * Возвращает границы периода для статистики в московском времени.
 * startDate/endDate — в UTC, для сравнения с completedAt/confirmedAt в БД.
 * - today: текущий день с утра по Москве (00:00–23:59)
 * - week: с начала недели (понедельник 00:00) по конец сегодня
 * - month: с начала месяца (1-е число 00:00) по конец сегодня
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
    const weekStart = getMoscowWeekStart();
    return { startDate: weekStart, endDate: todayEnd };
  }

  if (period === 'month') {
    const monthStart = startOfDayMoscowUTC(m.year, m.month, 1);
    return { startDate: monthStart, endDate: todayEnd };
  }

  return { startDate: todayStart, endDate: todayEnd };
}

/**
 * Границы одного дня по Москве (YYYY-MM-DD).
 */
export function getStatisticsDateRangeForDate(dateStr: string): StatisticsDateRange {
  const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) {
    const now = new Date();
    const p = getMoscowDateParts(now);
    return {
      startDate: startOfDayMoscowUTC(p.year, p.month, p.date),
      endDate: endOfDayMoscowUTC(p.year, p.month, p.date),
    };
  }
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const date = parseInt(m[3], 10);
  return {
    startDate: startOfDayMoscowUTC(year, month, date),
    endDate: endOfDayMoscowUTC(year, month, date),
  };
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
 * Период предыдущей недели (пн–вс) по Москве.
 */
export function getPreviousWeekRange(): StatisticsDateRange {
  const thisWeekStart = getMoscowWeekStart();
  const prevWeekStart = new Date(thisWeekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const prevWeekEnd = new Date(thisWeekStart.getTime() - 1);
  return { startDate: prevWeekStart, endDate: prevWeekEnd };
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

/** Сейчас время обеда по Москве? 13–14 или 14–15 = да. Остальное = нет. */
export function isLunchTimeMoscow(utcNow: Date = new Date()): boolean {
  const h = getMoscowHour(utcNow);
  return h >= 13 && h < 15;
}

/** Время начала обеда по Москве в UTC: 13:00 или 14:00 МСК сегодня. */
export function getLunchScheduledForMoscow(slot: '13-14' | '14-15'): Date {
  const now = new Date();
  const m = getMoscowDateParts(now);
  const startOfDay = startOfDayMoscowUTC(m.year, m.month, m.date);
  const hour = slot === '13-14' ? 13 : 14;
  return new Date(startOfDay.getTime() + hour * 60 * 60 * 1000);
}

/** Временные регионы действуют до 21:00 МСК. После 21:00 «сегодня» для них закончилось. */
export function isBeforeEndOfWorkingDay(utcNow: Date = new Date()): boolean {
  return getMoscowHour(utcNow) < 21;
}

/**
 * Последние 5 рабочих дней (пн–пт) ДО указанной даты по Москве.
 * Возвращает [startDate, endDate] для каждого дня в UTC.
 */
export function getLast5WorkingDaysMoscow(beforeDate: Date): Array<{ start: Date; end: Date }> {
  const m = getMoscowDateParts(beforeDate);
  const result: Array<{ start: Date; end: Date }> = [];
  let year = m.year;
  let month = m.month;
  let date = m.date;
  let count = 0;
  while (count < 5) {
    date--;
    if (date < 1) {
      const prev = new Date(Date.UTC(year, month, 0));
      date = prev.getUTCDate();
      month = prev.getUTCMonth();
      year = prev.getUTCFullYear();
    }
    const d = new Date(Date.UTC(year, month, date));
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const start = startOfDayMoscowUTC(year, month, date);
      const end = endOfDayMoscowUTC(year, month, date);
      result.push({ start, end });
      count++;
    }
  }
  return result;
}
