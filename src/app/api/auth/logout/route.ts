import { NextRequest, NextResponse } from 'next/server';
import { deleteSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (token) {
      await deleteSession(token);
    }

    cookieStore.delete('session_token');

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при выходе:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при выходе' },
      { status: 500 }
    );
  }
}

