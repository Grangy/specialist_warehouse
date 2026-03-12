import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { getMoscowDateString } from '@/lib/utils/moscowDate';

export const dynamic = 'force-dynamic';

const ADJUST_PASSWORD = '22170313';

type AdjustmentEntry = { points: number; date: string };
type AdjustmentsValue = Record<string, AdjustmentEntry[]>;

/** POST — ручное начисление/снятие баллов за доп. работу. Только admin. Требует пароль. */
/** Баллы применяются только за дату добавления (не дублируются каждый день). */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;
    const body = await request.json();
    const { userId, points, password } = body as { userId?: string; points?: number; password?: string };
    if (!userId || typeof points !== 'number') {
      return NextResponse.json({ error: 'Нужны userId и points (число, может быть отрицательным)' }, { status: 400 });
    }
    if (password !== ADJUST_PASSWORD) {
      return NextResponse.json({ error: 'Неверный пароль' }, { status: 403 });
    }

    const todayStr = getMoscowDateString(new Date());

    const s = await prisma.systemSettings.findUnique({ where: { key: 'extra_work_manual_adjustments' } });
    const raw = s?.value;
    let adj: AdjustmentsValue = {};

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed !== null) {
          for (const [uid, val] of Object.entries(parsed)) {
            if (Array.isArray(val)) {
              adj[uid] = val.filter((e: unknown) => e && typeof e === 'object' && 'points' in e && 'date' in e) as AdjustmentEntry[];
            } else if (typeof val === 'number') {
              adj[uid] = [{ points: val, date: todayStr }];
            }
          }
        }
      } catch {
        adj = {};
      }
    }

    const list = [...(adj[userId] ?? [])];
    list.push({ points: Math.round(points * 10) / 10, date: todayStr });
    const total = list.reduce((sum, e) => sum + e.points, 0);
    if (Math.abs(total) < 0.01) {
      delete adj[userId];
    } else {
      adj[userId] = list;
    }

    await prisma.systemSettings.upsert({
      where: { key: 'extra_work_manual_adjustments' },
      update: { value: JSON.stringify(adj) },
      create: { key: 'extra_work_manual_adjustments', value: JSON.stringify(adj) },
    });
    return NextResponse.json({ ok: true, manualAdjustment: total });
  } catch (e) {
    console.error('[extra-work/adjust-points]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
