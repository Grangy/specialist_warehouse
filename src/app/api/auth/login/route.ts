import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, createSession } from '@/lib/auth';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { login, password } = await request.json();

    if (!login || !password) {
      return NextResponse.json(
        { error: 'Логин и пароль обязательны' },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { login },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    const token = await createSession(user.id);
    const cookieStore = await cookies();
    
    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 дней
      path: '/',
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error('Ошибка при входе:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при входе' },
      { status: 500 }
    );
  }
}

