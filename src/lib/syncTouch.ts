import { prisma } from '@/lib/prisma';
import { formatErrorForLog } from '@/lib/formatErrorForLog';

const SYNC_TOUCH_ID = 1;
const RETRIES = 4;
const BASE_DELAY_MS = 40;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableSyncTouchError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const code = (e as { code?: string }).code;
  // P1008 — Socket timeout (SQLite занят длинным запросом / блокировка)
  return code === 'P1008';
}

/**
 * Пометить, что данные изменились (сборка, проверка, lock и т.д.).
 * Poll проверяет sync_touch.touchedAt > since и возвращает hasUpdates — все клиенты подтягивают список.
 * Вызывать по триггерам (после успешного сохранения), не в циклах.
 */
export async function touchSync(): Promise<void> {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await prisma.syncTouch.upsert({
        where: { id: SYNC_TOUCH_ID },
        create: { id: SYNC_TOUCH_ID, touchedAt: new Date() },
        update: { touchedAt: new Date() },
      });
      return;
    } catch (e) {
      if (isRetryableSyncTouchError(e) && attempt < RETRIES) {
        await sleep(BASE_DELAY_MS * attempt);
        continue;
      }
      console.error('[syncTouch]', formatErrorForLog(e));
      return;
    }
  }
}
