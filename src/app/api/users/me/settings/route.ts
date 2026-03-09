import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { UserCollectSettings } from '@/types';

const DEFAULT: UserCollectSettings = {
  collectPositionConfirm: 'swipe',
  collectOverallConfirm: 'swipe',
};

export const dynamic = 'force-dynamic';

/** GET /api/users/me/settings — получить настройки текущего пользователя */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const row = await prisma.userSettings.findUnique({
      where: { userId: user.id },
    });

    let settings: UserCollectSettings = DEFAULT;
    if (row?.settings) {
      try {
        const parsed = JSON.parse(row.settings) as Partial<UserCollectSettings>;
        settings = {
          collectPositionConfirm: ['swipe', 'double-click'].includes(parsed.collectPositionConfirm as string)
            ? (parsed.collectPositionConfirm as UserCollectSettings['collectPositionConfirm'])
            : DEFAULT.collectPositionConfirm,
          collectOverallConfirm: ['swipe', 'double-click'].includes(parsed.collectOverallConfirm as string)
            ? (parsed.collectOverallConfirm as UserCollectSettings['collectOverallConfirm'])
            : DEFAULT.collectOverallConfirm,
        };
      } catch {
        // ignore invalid JSON
      }
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Ошибка при получении настроек:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении настроек' },
      { status: 500 }
    );
  }
}

/** POST /api/users/me/settings — сохранить настройки текущего пользователя */
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
    }

    const body = await request.json();
    const collectPositionConfirm = body.collectPositionConfirm;
    const collectOverallConfirm = body.collectOverallConfirm;

    const settings: UserCollectSettings = {
      collectPositionConfirm: ['swipe', 'double-click'].includes(collectPositionConfirm)
        ? collectPositionConfirm
        : DEFAULT.collectPositionConfirm,
      collectOverallConfirm: ['swipe', 'double-click'].includes(collectOverallConfirm)
        ? collectOverallConfirm
        : DEFAULT.collectOverallConfirm,
    };

    const existing = await prisma.userSettings.findUnique({
      where: { userId: user.id },
    });
    const merged: Record<string, unknown> = { ...settings };
    if (existing?.settings) {
      try {
        const parsed = JSON.parse(existing.settings) as Record<string, unknown>;
        if (parsed.extraWorkLunchSlot !== undefined) merged.extraWorkLunchSlot = parsed.extraWorkLunchSlot;
      } catch {
        // ignore
      }
    }
    const finalSettings = JSON.stringify(merged);
    if (existing) {
      await prisma.userSettings.update({
        where: { userId: user.id },
        data: { settings: finalSettings },
      });
    } else {
      await prisma.userSettings.create({
        data: { userId: user.id, settings: finalSettings },
      });
    }

    return NextResponse.json(settings);
  } catch (error) {
    console.error('Ошибка при сохранении настроек:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сохранении настроек' },
      { status: 500 }
    );
  }
}
