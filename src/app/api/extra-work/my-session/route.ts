import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getMoscowHour } from '@/lib/utils/moscowDate';
import { computeExtraWorkPointsForSession, getExtraWorkRatePerHour } from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '@/lib/ranking/weekdayCoefficients';
import { autoStopExtraWorkAt18 } from '@/lib/extraWorkAutoStop';
import { syncExtraWorkSessionLunchState } from '@/lib/extraWorkLunch';
import { computeExtraWorkElapsedSecNow, maybeHealElapsedSecBeforeLunch } from '@/lib/extraWorkElapsed';

export const dynamic = 'force-dynamic';

/** Кэш ставки/коэф. на ~30 с — getExtraWorkRatePerHour тяжёлый (агрегаты Prisma), опрос каждые 5 с не должен считать его каждый раз */
const RATE_CACHE_TTL_MS = 30_000;
const rateCache = new Map<string, { rate: number; dayCoef: number; expires: number }>();

let lastAutoStopExtraWorkAt = 0;
const AUTOSTOP_MIN_INTERVAL_MS = 45_000;

async function maybeAutoStopExtraWorkAt18(): Promise<void> {
  if (getMoscowHour(new Date()) < 18) return;
  const now = Date.now();
  if (now - lastAutoStopExtraWorkAt < AUTOSTOP_MIN_INTERVAL_MS) return;
  lastAutoStopExtraWorkAt = now;
  await autoStopExtraWorkAt18();
}

/** Активная сессия доп.работы текущего пользователя (для попапа «Стоп») */
export async function GET(request: NextRequest) {
  try {
    await maybeAutoStopExtraWorkAt18();

    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    let session = await prisma.extraWorkSession.findFirst({
      where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    const now = new Date();
    if (session) {
      await syncExtraWorkSessionLunchState(prisma, session as any, now);
      session = await prisma.extraWorkSession.findFirst({
        where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
        orderBy: { startedAt: 'desc' },
      });
      if (session) {
        await maybeHealElapsedSecBeforeLunch(prisma, session as any, now);
        session = await prisma.extraWorkSession.findFirst({
          where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
          orderBy: { startedAt: 'desc' },
        });
      }
    }

    if (!session) return NextResponse.json(null);

    const cacheKey = session.userId;
    let ratePerHour: number;
    let dayCoefficient: number;
    const hit = rateCache.get(cacheKey);
    if (hit && hit.expires > Date.now()) {
      ratePerHour = hit.rate;
      dayCoefficient = hit.dayCoef;
    } else {
      [ratePerHour, dayCoefficient] = await Promise.all([
        getExtraWorkRatePerHour(prisma, session.userId, now),
        getWeekdayCoefficientForDate(prisma, now),
      ]);
      rateCache.set(cacheKey, {
        rate: ratePerHour,
        dayCoef: dayCoefficient,
        expires: Date.now() + RATE_CACHE_TTL_MS,
      });
    }

    const elapsed = computeExtraWorkElapsedSecNow(session as any, now);
    const farmedPointsRaw = await computeExtraWorkPointsForSession(prisma, {
      userId: session.userId,
      elapsedSecBeforeLunch: elapsed,
      stoppedAt: now,
      startedAt: session.startedAt,
      lunchStartedAt: session.lunchStartedAt,
      lunchEndsAt: session.lunchEndsAt,
    });
    const farmedPoints = Math.round(farmedPointsRaw * 10) / 10;
    const elapsedSecNow = Math.round(elapsed * 10) / 10;

    return NextResponse.json({
      ...session,
      ratePerHour: session.status === 'lunch' ? 0 : Math.round(ratePerHour * 100) / 100,
      dayCoefficient: Math.round(dayCoefficient * 100) / 100,
      farmedPoints,
      /** Для UI-таймера: одно значение с сервера, без двойного учёта сегмента */
      elapsedSecNow,
      pointsSyncedAt: now.toISOString(),
    });
  } catch (e) {
    console.error('[extra-work/my-session]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
