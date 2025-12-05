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
    
    // Определяем, используется ли HTTPS для cookie secure флага
    // Проблема: в production с HTTP (например, локальная сеть для PWA) 
    // secure: true не позволит установить cookie
    // Решение: проверяем переменную окружения или заголовки
    
    // 1. Явное указание через переменную окружения (приоритет)
    const forceSecure = process.env.NEXT_PUBLIC_FORCE_SECURE_COOKIE === 'true';
    const disableSecure = process.env.NEXT_PUBLIC_DISABLE_SECURE_COOKIE === 'true';
    
    // 2. Проверяем заголовок X-Forwarded-Proto (для прокси/обратного прокси)
    const forwardedProto = request.headers.get('x-forwarded-proto');
    
    // 3. Пытаемся определить из URL (может быть относительным в Next.js)
    let isHttps = false;
    try {
      if (request.url.startsWith('https://')) {
        isHttps = true;
      } else if (forwardedProto === 'https') {
        isHttps = true;
      }
    } catch (e) {
      // Игнорируем ошибки парсинга URL
    }
    
    // Определяем secure флаг:
    // - Если явно отключен через env - false
    // - Если явно включен через env - true  
    // - Иначе: в production только если HTTPS, в dev - false
    const isSecure = disableSecure 
      ? false 
      : (forceSecure || (process.env.NODE_ENV === 'production' && isHttps));
    
    cookieStore.set('session_token', token, {
      httpOnly: true,
      secure: isSecure,
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

