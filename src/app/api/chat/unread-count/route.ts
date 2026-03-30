import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

function parseSinceMs(v: string | null): number | null {
  if (!v) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const roomKey = (searchParams.get('roomKey') || 'general').trim() || 'general';
    const sinceMs = parseSinceMs(searchParams.get('since'));
    if (!sinceMs) return NextResponse.json({ unreadCount: 0 });

    const room = await prisma.chatRoom.upsert({
      where: { key: roomKey },
      update: {},
      create: { key: roomKey },
    });

    const unreadCount = await prisma.chatMessage.count({
      where: {
        roomId: room.id,
        createdAt: { gt: new Date(sinceMs) },
      },
    });

    return NextResponse.json({ unreadCount });
  } catch (error) {
    console.error('chat/unread-count GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

