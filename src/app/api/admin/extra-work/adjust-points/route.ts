import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { canAccessExtraWorkByUser } from '@/lib/extraWorkAccess';

export const dynamic = 'force-dynamic';

const ADJUST_PASSWORD = '22170313';

/** POST — ручное начисление/снятие баллов за доп. работу. Требует пароль. */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;
    if (!canAccessExtraWorkByUser(user)) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const body = await request.json();
    const { userId, points, password } = body as { userId?: string; points?: number; password?: string };
    if (!userId || typeof points !== 'number') {
      return NextResponse.json({ error: 'Нужны userId и points (число, может быть отрицательным)' }, { status: 400 });
    }
    if (password !== ADJUST_PASSWORD) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 403 });
    }

    const s = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } });
    const adj = s?.value ? (JSON.parse(s.value) as Record<string, number>) : {};
    const current = adj[userId] ?? 0;
    const next = Math.round((current + points) * 10) / 10; // до 1 знака
    adj[userId] = next;
    if (Math.abs(next) < 0.01) delete adj[userId];

    await prisma.systemSettings.upsert({
      where: { key: 'extra_work_manual_adjustments' },
      update: { value: JSON.stringify(adj) },
      create: { key: 'extra_work_manual_adjustments', value: JSON.stringify(adj) },
    });
    return NextResponse.json({ ok: true, manualAdjustment: adj[userId] ?? 0 });
  } catch (e) {
    console.error('[extra-work/adjust-points]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
