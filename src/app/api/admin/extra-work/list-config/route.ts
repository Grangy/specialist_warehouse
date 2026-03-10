import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

export const dynamic = 'force-dynamic';

/** GET — текущий список скрытых пользователей */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const s = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_list_config' } });
    const config = s?.value ? (JSON.parse(s.value) as { hiddenUserIds?: string[] }) : {};
    return NextResponse.json({ hiddenUserIds: config.hiddenUserIds ?? [] });
  } catch (e) {
    console.error('[extra-work/list-config]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

/** POST — переключить скрытие пользователя */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const body = await request.json();
    const { userId, hidden } = body as { userId?: string; hidden?: boolean };
    if (!userId || typeof hidden !== 'boolean') {
      return NextResponse.json({ error: 'Нужны userId и hidden' }, { status: 400 });
    }
    const s = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_list_config' } });
    const config = s?.value ? (JSON.parse(s.value) as { hiddenUserIds?: string[] }) : { hiddenUserIds: [] };
    const list = [...(config.hiddenUserIds ?? [])];
    const idx = list.indexOf(userId);
    if (hidden && idx < 0) list.push(userId);
    else if (!hidden && idx >= 0) list.splice(idx, 1);
    await prisma.systemSettings.upsert({
      where: { key: 'extra_work_list_config' },
      update: { value: JSON.stringify({ hiddenUserIds: list }) },
      create: { key: 'extra_work_list_config', value: JSON.stringify({ hiddenUserIds: list }) },
    });
    return NextResponse.json({ hiddenUserIds: list });
  } catch (e) {
    console.error('[extra-work/list-config]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
