/**
 * Лог всех взаимодействий с 1С: запросы, ответы, синхронизация статусов.
 * Файл: logs/1c-YYYY-MM-DD.log (одна строка = один JSON-объект).
 * Для аудита: почему заказы не возвращаются в 1С, не обновляют статус и т.д.
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_PREFIX = '1c-';

function getDateStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLogFilePath(): string {
  return path.join(LOG_DIR, `${LOG_PREFIX}${getDateStr()}.log`);
}

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch (e) {
    console.error('[1cLog] Не удалось создать каталог logs:', e);
  }
}

export type LogDirection = 'in' | 'out';

export interface OneCLogEntry {
  ts: string; // ISO
  type: string; // sync-1c | ready-for-export | mark-exported-1c | shipments-post
  direction: LogDirection;
  requestId?: string;
  endpoint: string;
  summary: string;
  /** Краткие данные без паролей и больших тел */
  details?: Record<string, unknown>;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * Добавить запись в лог 1С. Вызывать при каждом запросе/ответе.
 */
export function append1cLog(entry: OneCLogEntry): void {
  try {
    ensureLogDir();
    const line = safeStringify(entry) + '\n';
    fs.appendFileSync(getLogFilePath(), line, 'utf8');
  } catch (e) {
    console.error('[1cLog] Ошибка записи:', e);
  }
}

/**
 * Прочитать последние N строк из лога за дату (для админки/аудита).
 */
export function read1cLog(options: { date?: string; tail?: number }): { lines: string[]; path: string } {
  const dateStr = options.date || getDateStr();
  const filePath = path.join(LOG_DIR, `${LOG_PREFIX}${dateStr}.log`);
  const tail = Math.min(Math.max(0, options.tail ?? 500), 5000);

  if (!fs.existsSync(filePath)) {
    return { lines: [], path: filePath };
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n').filter((s) => s.trim());
    const lines = tail > 0 ? allLines.slice(-tail) : allLines;
    return { lines, path: filePath };
  } catch (e) {
    console.error('[1cLog] Ошибка чтения:', e);
    return { lines: [], path: filePath };
  }
}

/**
 * Список доступных дат (по наличию файлов в logs/).
 */
export function list1cLogDates(): string[] {
  try {
    ensureLogDir();
    if (!fs.existsSync(LOG_DIR)) return [];
    const files = fs.readdirSync(LOG_DIR);
    const dates = files
      .filter((f) => f.startsWith(LOG_PREFIX) && f.endsWith('.log'))
      .map((f) => f.slice(LOG_PREFIX.length, -4))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort()
      .reverse();
    return dates;
  } catch {
    return [];
  }
}
