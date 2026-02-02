import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { setPendingMessage } from '@/lib/adminMessages';

export const dynamic = 'force-dynamic';

const ALLOWED_RECIPIENT_ROLES = ['collector', 'checker', 'warehouse_3'] as const;

/**
 * POST /api/admin/send-message
 * Отправка сообщения пользователю (сборщик, проверяльщик, склад 3).
 * Только администратор. Сообщение показывается полноэкранным попапом со звуком.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user: admin } = authResult;

    const body = await request.json().catch(() => ({}));
    const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!userId || !text) {
      return NextResponse.json(
        { error: 'Укажите userId и текст сообщения.' },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    });

    if (!target) {
      return NextResponse.json(
        { error: 'Пользователь не найден.' },
        { status: 404 }
      );
    }

    if (!ALLOWED_RECIPIENT_ROLES.includes(target.role as (typeof ALLOWED_RECIPIENT_ROLES)[number])) {
      return NextResponse.json(
        { error: 'Сообщения можно отправлять только сборщикам, проверяльщикам и пользователям Склад 3.' },
        { status: 400 }
      );
    }

    setPendingMessage(target.id, {
      text,
      fromName: admin.name,
    });

    return NextResponse.json({
      success: true,
      message: `Сообщение отправлено пользователю ${target.name}.`,
    });
  } catch (error) {
    console.error('[admin/send-message]', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при отправке сообщения.' },
      { status: 500 }
    );
  }
}
