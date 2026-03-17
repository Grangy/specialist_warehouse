import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';
import { computeExtraWorkPointsForSession } from '@/lib/ranking/extraWorkPoints';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get('days');
    const days = daysParam ? Math.min(90, Math.max(1, parseInt(daysParam, 10) || 14)) : 14;

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - days);

    const sessions = await prisma.extraWorkSession.findMany({
      where: {
        status: 'stopped',
        stoppedAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        userId: true,
        assignedById: true,
        warehouse: true,
        comment: true,
        startedAt: true,
        stoppedAt: true,
        elapsedSecBeforeLunch: true,
        completionType: true,
        durationMinutes: true,
        user: { select: { name: true } },
        assignedBy: { select: { name: true } },
      },
      orderBy: { stoppedAt: 'desc' },
    });

    const items = await Promise.all(
      sessions.map(async (s) => {
        const pts = await computeExtraWorkPointsForSession(prisma, {
          userId: s.userId,
          elapsedSecBeforeLunch: s.elapsedSecBeforeLunch ?? 0,
          stoppedAt: s.stoppedAt,
          startedAt: s.startedAt,
        });
        return {
          id: s.id,
          userName: s.user?.name ?? s.userId.slice(0, 8),
          assignedByName: s.assignedBy?.name ?? '',
          warehouse: s.warehouse ?? '—',
          comment: s.comment ?? '',
          startedAt: s.startedAt,
          stoppedAt: s.stoppedAt,
          hours: (s.elapsedSecBeforeLunch ?? 0) / 3600,
          points: Math.round(pts * 10) / 10,
          completionType: s.completionType,
          durationMinutes: s.durationMinutes,
        };
      })
    );

    return NextResponse.json({
      items,
      period: { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10), days },
    });
  } catch (e) {
    console.error('[extra-work/history]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
