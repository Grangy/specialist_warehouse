import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { isLunchTimeMoscow } from '@/lib/utils/moscowDate';
import { getExtraWorkRatePerHour } from '@/lib/ranking/extraWorkPoints';
import { getWeekdayCoefficientForDate } from '@/lib/ranking/weekdayCoefficients';
import { autoStopExtraWorkAt18 } from '@/lib/extraWorkAutoStop';

export const dynamic = 'force-dynamic';

/** Активная сессия доп.работы текущего пользователя (для попапа «Стоп») */
export async function GET(request: NextRequest) {
  try {
    await autoStopExtraWorkAt18();

    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    let session = await prisma.extraWorkSession.findFirst({
      where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
      orderBy: { startedAt: 'desc' },
    });

    // Строгая проверка: снимаем «Обед»/«Обед запланирован», если не время обеда по Москве (13:00–14:59)
    const now = new Date();
    const notLunchTime = !isLunchTimeMoscow(now);
    if (session?.status === 'lunch') {
      const lunchEndsPassed = session.lunchEndsAt && now.getTime() >= session.lunchEndsAt.getTime();
      if (lunchEndsPassed || notLunchTime) {
        await prisma.extraWorkSession.update({
          where: { id: session.id },
          data: {
            status: 'running',
            postLunchStartedAt: session.lunchEndsAt ?? now,
            lunchStartedAt: null,
            lunchEndsAt: null,
          },
        });
        session = await prisma.extraWorkSession.findFirst({
          where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
          orderBy: { startedAt: 'desc' },
        });
      }
    } else if (session?.status === 'lunch_scheduled' && notLunchTime) {
      await prisma.extraWorkSession.update({
        where: { id: session.id },
        data: { status: 'running', lunchSlot: null, lunchScheduledFor: null },
      });
      session = await prisma.extraWorkSession.findFirst({
        where: { userId: user.id, status: { in: ['running', 'lunch', 'lunch_scheduled'] }, stoppedAt: null },
        orderBy: { startedAt: 'desc' },
      });
    }

    if (!session) return NextResponse.json(null);

    const [ratePerHour, dayCoefficient] = await Promise.all([
      getExtraWorkRatePerHour(prisma, session.userId, now),
      getWeekdayCoefficientForDate(prisma, now),
    ]);

    return NextResponse.json({
      ...session,
      ratePerHour: Math.round(ratePerHour * 100) / 100,
      dayCoefficient: Math.round(dayCoefficient * 100) / 100,
    });
  } catch (e) {
    console.error('[extra-work/my-session]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
