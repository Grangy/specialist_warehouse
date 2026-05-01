import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';
import { setPendingMessage } from '@/lib/adminMessages';
import {
  EXTRA_WORK_ALLOWED_NAME_PATTERNS,
} from '@/lib/extraWorkAccess';
import {
  loadExtraWorkRequests,
  saveExtraWorkRequests,
  type ExtraWorkRequestItem,
} from '@/lib/extraWorkRequests';

export const dynamic = 'force-dynamic';

function isDmitryPalychName(name: string): boolean {
  const lower = (name || '').toLowerCase();
  return EXTRA_WORK_ALLOWED_NAME_PATTERNS.some((p) => lower.includes(p.has) && lower.includes(p.and));
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const body = await request.json().catch(() => ({}));
    const requestedTask = typeof body.requestedTask === 'string' ? body.requestedTask.trim() : '';
    if (requestedTask.length < 5) {
      return NextResponse.json({ error: 'Опишите, что будете делать (минимум 5 символов).' }, { status: 400 });
    }
    if (requestedTask.length > 500) {
      return NextResponse.json({ error: 'Слишком длинное описание (максимум 500 символов).' }, { status: 400 });
    }

    const approver = await prisma.user.findFirst({
      where: { role: { in: ['admin', 'checker'] } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    const dmitry = await prisma.user.findFirst({
      where: { role: { in: ['admin', 'checker'] } },
      select: { id: true, name: true },
    });
    const approverUser = (
      await prisma.user.findMany({
        where: { role: { in: ['admin', 'checker'] } },
        select: { id: true, name: true },
      })
    ).find((u) => isDmitryPalychName(u.name));
    const target = approverUser ?? approver ?? dmitry;
    if (!target) {
      return NextResponse.json({ error: 'Не найден получатель запроса (Дмитрий Палыч).' }, { status: 500 });
    }

    const requests = await loadExtraWorkRequests(prisma);
    const alreadyPending = requests.find((r) => r.requesterId === user.id && r.status === 'pending');
    if (alreadyPending) {
      return NextResponse.json({ error: 'У вас уже есть незавершённый запрос на доп. работу.' }, { status: 400 });
    }

    const item: ExtraWorkRequestItem = {
      id: `ewr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      requesterId: user.id,
      requesterName: user.name,
      requestedTask,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    requests.push(item);
    await saveExtraWorkRequests(prisma, requests);

    setPendingMessage(target.id, {
      type: 'admin',
      fromName: user.name,
      text: `Запрос доп. работы от ${user.name}: ${requestedTask}`,
    });

    return NextResponse.json({ success: true, requestId: item.id });
  } catch (e) {
    console.error('[extra-work/request]', e);
    return NextResponse.json({ error: 'Ошибка при отправке запроса.' }, { status: 500 });
  }
}

