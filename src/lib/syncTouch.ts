import { prisma } from '@/lib/prisma';

const SYNC_TOUCH_ID = 1;

/**
 * Пометить, что данные изменились (сборка, проверка, lock и т.д.).
 * Poll проверяет sync_touch.touchedAt > since и возвращает hasUpdates — все клиенты подтягивают список.
 * Вызывать по триггерам (после успешного сохранения), не в циклах.
 */
export async function touchSync(): Promise<void> {
  try {
    await prisma.syncTouch.upsert({
      where: { id: SYNC_TOUCH_ID },
      create: { id: SYNC_TOUCH_ID, touchedAt: new Date() },
      update: { touchedAt: new Date() },
    });
  } catch (e) {
    console.error('[syncTouch]', e);
  }
}
