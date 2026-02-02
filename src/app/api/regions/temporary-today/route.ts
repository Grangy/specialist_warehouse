/**
 * Временные регионы на сегодня: действуют до 21:00 МСК, затем не показываются.
 * GET — список временных регионов на сегодня (если сейчас < 21:00 МСК).
 * POST — добавить регион на сегодня (body: { region }).
 * PUT — изменить порядок (body: { items: [{ region, priority }] }).
 * DELETE — убрать регион с сегодня (query: region=...).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getMoscowDateString, isBeforeEndOfWorkingDay } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

function getTodayDate(): string {
  return getMoscowDateString(new Date());
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    if (!isBeforeEndOfWorkingDay(new Date())) {
      return NextResponse.json([]);
    }

    const date = getTodayDate();
    const list = await prisma.temporaryRegionPriority.findMany({
      where: { date },
      orderBy: { priority: 'asc' },
    });

    return NextResponse.json(list.map((r) => ({ id: r.id, region: r.region, priority: r.priority })));
  } catch (error) {
    console.error('[API temporary-today GET]', error);
    return NextResponse.json(
      { error: 'Ошибка при получении временных регионов' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    if (!isBeforeEndOfWorkingDay(new Date())) {
      return NextResponse.json(
        { error: 'Временные регионы можно добавлять только до 21:00 МСК' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const region = typeof body.region === 'string' ? body.region.trim() : null;
    if (!region) {
      return NextResponse.json({ error: 'Укажите region' }, { status: 400 });
    }

    const date = getTodayDate();
    const max = await prisma.temporaryRegionPriority.aggregate({
      where: { date },
      _max: { priority: true },
    });
    const nextPriority = (max._max.priority ?? -1) + 1;

    const created = await prisma.temporaryRegionPriority.upsert({
      where: {
        date_region: { date, region },
      },
      create: { date, region, priority: nextPriority },
      update: { priority: nextPriority },
    });

    return NextResponse.json({ id: created.id, region: created.region, priority: created.priority });
  } catch (error) {
    console.error('[API temporary-today POST]', error);
    return NextResponse.json(
      { error: 'Ошибка при добавлении временного региона' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const body = await request.json();
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Укажите items: [{ region, priority }]' }, { status: 400 });
    }

    const date = getTodayDate();
    for (let i = 0; i < items.length; i++) {
      const region = items[i].region;
      const priority = items[i].priority;
      if (typeof region !== 'string') continue;
      await prisma.temporaryRegionPriority.updateMany({
        where: { date, region },
        data: { priority: typeof priority === 'number' ? priority : i },
      });
    }

    const list = await prisma.temporaryRegionPriority.findMany({
      where: { date },
      orderBy: { priority: 'asc' },
    });
    return NextResponse.json(list.map((r) => ({ id: r.id, region: r.region, priority: r.priority })));
  } catch (error) {
    console.error('[API temporary-today PUT]', error);
    return NextResponse.json(
      { error: 'Ошибка при изменении порядка временных регионов' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');
    if (!region) {
      return NextResponse.json({ error: 'Укажите region в query' }, { status: 400 });
    }

    const date = getTodayDate();
    await prisma.temporaryRegionPriority.deleteMany({
      where: { date, region },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API temporary-today DELETE]', error);
    return NextResponse.json(
      { error: 'Ошибка при удалении временного региона' },
      { status: 500 }
    );
  }
}
