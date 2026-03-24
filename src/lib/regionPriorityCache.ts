import { prisma } from '@/lib/prisma';
import { getMoscowDateString, isBeforeEndOfWorkingDay } from '@/lib/utils/moscowDate';

/**
 * Кэш списков регионов для GET /api/shipments: снижает повторные findMany на каждый запрос.
 * Ключ включает sync_touch (изменения заказов/временных регионов с touchSync) и календарный день.
 * При правках приоритетов без touchSync вызывайте invalidateRegionPriorityCache или touchSync в маршруте.
 */
let cached:
  | {
      key: string;
      regionPriorities: Awaited<ReturnType<typeof prisma.regionPriority.findMany>>;
      temporaries: Awaited<ReturnType<typeof prisma.temporaryRegionPriority.findMany>>;
    }
  | null = null;

export function invalidateRegionPriorityCache(): void {
  cached = null;
}

export async function getCachedRegionLists(): Promise<{
  regionPriorities: Awaited<ReturnType<typeof prisma.regionPriority.findMany>>;
  temporaries: Awaited<ReturnType<typeof prisma.temporaryRegionPriority.findMany>>;
}> {
  const syncRow = await prisma.syncTouch.findUnique({
    where: { id: 1 },
    select: { touchedAt: true },
  });
  const touched = syncRow?.touchedAt?.getTime() ?? 0;
  const todayStr = getMoscowDateString(new Date());
  const dayOfWeek = (new Date().getDay() + 6) % 7;
  const currentDay = Math.min(dayOfWeek, 4);
  const key = `${touched}|${todayStr}|${currentDay}`;

  if (cached?.key === key) {
    return { regionPriorities: cached.regionPriorities, temporaries: cached.temporaries };
  }

  const regionPriorities = await prisma.regionPriority.findMany();
  let temporaries: Awaited<ReturnType<typeof prisma.temporaryRegionPriority.findMany>> = [];
  if (isBeforeEndOfWorkingDay(new Date())) {
    temporaries = await prisma.temporaryRegionPriority.findMany({
      where: { date: todayStr },
      orderBy: { priority: 'asc' },
    });
  }

  cached = { key, regionPriorities, temporaries };
  return { regionPriorities, temporaries };
}
