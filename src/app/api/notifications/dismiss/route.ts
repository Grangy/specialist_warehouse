import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { dismissMessage } from '@/lib/adminMessages';

export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/dismiss
 * Закрытие (прочтение) сообщения от админа для текущего пользователя.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    dismissMessage(user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[notifications/dismiss]', error);
    return NextResponse.json(
      { error: 'Ошибка сервера.' },
      { status: 500 }
    );
  }
}
