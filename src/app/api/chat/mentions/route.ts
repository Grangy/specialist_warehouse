import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    const unreadCount = await prisma.chatMention.count({
      where: { userId: user.id, seenAt: null },
    });

    return NextResponse.json({ unreadCount });
  } catch (error) {
    console.error('chat/mentions GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;
    const { user } = authResult;

    // mark all as seen (v1)
    await prisma.chatMention.updateMany({
      where: { userId: user.id, seenAt: null },
      data: { seenAt: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('chat/mentions POST error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

