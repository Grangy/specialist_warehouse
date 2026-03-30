import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

function safeParseSettings(settings: string | null | undefined): Record<string, unknown> {
  if (!settings) return {};
  try {
    const parsed = JSON.parse(settings);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

function pickAvatarEmoji(settings: string | null | undefined): string | null {
  const s = safeParseSettings(settings);
  const v = s.avatarEmoji;
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 16) : null;
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/^@+/, '').slice(0, 32);
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const q = normalizeQuery(searchParams.get('q') || '');
    const qLower = q.toLowerCase();
    const like = q ? `%${qLower}%` : null;
    const users = await prisma.$queryRaw<Array<{ id: string; login: string; name: string; role: string }>>`
      SELECT id, login, name, role
      FROM users
      WHERE ${q ? prisma.$queryRaw`(lower(login) LIKE ${like} OR lower(name) LIKE ${like})` : prisma.$queryRaw`1=1`}
      ORDER BY
        CASE WHEN role = 'admin' THEN 0 ELSE 1 END,
        CASE WHEN ${q ? prisma.$queryRaw`lower(login) = ${qLower}` : prisma.$queryRaw`0`} THEN 0 ELSE 1 END,
        CASE WHEN ${q ? prisma.$queryRaw`lower(login) LIKE ${qLower + '%'}` : prisma.$queryRaw`0`} THEN 0 ELSE 1 END,
        CASE WHEN ${q ? prisma.$queryRaw`lower(name) LIKE ${qLower + '%'}` : prisma.$queryRaw`0`} THEN 0 ELSE 1 END,
        name ASC
      LIMIT 8
    `;

    const ids = users.map((u) => u.id);
    const settings = ids.length
      ? await prisma.userSettings.findMany({
          where: { userId: { in: ids } },
          select: { userId: true, settings: true },
        })
      : [];
    const map = new Map(settings.map((s) => [s.userId, s.settings]));

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        login: u.login,
        name: u.name,
        role: u.role,
        avatarEmoji: pickAvatarEmoji(map.get(u.id)),
      })),
    });
  } catch (error) {
    console.error('chat/user-search GET error', error);
    return NextResponse.json({ error: 'Ошибка сервера' }, { status: 500 });
  }
}

