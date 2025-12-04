import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionUser();

    if (!user) {
      // Возвращаем 200 с user: null вместо 401, чтобы не показывать ошибки в консоли
      return NextResponse.json({ user: null });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error('Ошибка при проверке сессии:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при проверке сессии' },
      { status: 500 }
    );
  }
}

