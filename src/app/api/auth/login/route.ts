import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPassword, createSession } from '@/lib/auth';
import { cookies } from 'next/headers';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimiter';
import { validateLogin, validatePassword } from '@/lib/security/inputValidator';
import { logSecurityEvent } from '@/lib/security/securityLogger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    // Проверка rate limiting для логина ОТКЛЮЧЕНА
    // const clientId = getClientIdentifier(request);
    // const rateLimit = checkRateLimit(clientId, 'login');
    // if (!rateLimit.allowed) {
    //   logSecurityEvent('rate_limit_exceeded', {
    //     ip,
    //     userAgent,
    //     details: `Login attempts exceeded for ${clientId}`,
    //   });
    //   return NextResponse.json(
    //     { 
    //       error: 'Слишком много попыток входа. Попробуйте позже.',
    //       retryAfter: Math.ceil((rateLimit.resetTime - Date.now()) / 1000),
    //     },
    //     { 
    //       status: 429,
    //       headers: {
    //         'Retry-After': String(Math.ceil((rateLimit.resetTime - Date.now()) / 1000)),
    //         'X-RateLimit-Limit': '5',
    //         'X-RateLimit-Remaining': '0',
    //         'X-RateLimit-Reset': String(rateLimit.resetTime),
    //       },
    //     }
    //   );
    // }

    const { login, password } = await request.json();

    // Валидация входных данных
    const loginValidation = validateLogin(login);
    if (!loginValidation.valid) {
      logSecurityEvent('suspicious_activity', {
        ip,
        userAgent,
        login,
        details: `Invalid login format: ${loginValidation.error}`,
      });
      const clientError = process.env.NODE_ENV === 'development' ? loginValidation.error : 'Неверный формат логина';
      return NextResponse.json(
        { error: clientError },
        { status: 400 }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      logSecurityEvent('suspicious_activity', {
        ip,
        userAgent,
        login: loginValidation.sanitized,
        details: `Invalid password format: ${passwordValidation.error}`,
      });
      const clientError = process.env.NODE_ENV === 'development' ? passwordValidation.error : 'Неверный формат пароля';
      return NextResponse.json(
        { error: clientError },
        { status: 400 }
      );
    }

    const sanitizedLogin = loginValidation.sanitized!;

    const user = await prisma.user.findUnique({
      where: { login: sanitizedLogin },
    });

    if (!user) {
      logSecurityEvent('login_failure', {
        ip,
        userAgent,
        login: sanitizedLogin,
        details: 'User not found',
      });
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.password);

    if (!isValid) {
      logSecurityEvent('login_failure', {
        ip,
        userAgent,
        login: sanitizedLogin,
        userId: user.id,
        details: 'Invalid password',
      });
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    // Успешный вход
    logSecurityEvent('login_success', {
      ip,
      userAgent,
      login: sanitizedLogin,
      userId: user.id,
    });

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
    const isHttps = forwardedProto === 'https';
    
    // Определяем secure флаг:
    // - Если явно отключен через env - false
    // - Если явно включен через env - true  
    // - Иначе: в production только если HTTPS (через заголовок), в dev - false
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
  } catch (error: unknown) {
    console.error('Ошибка при входе:', error);
    if (process.env.NODE_ENV === 'development') {
      console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    }
    return NextResponse.json(
      {
        error: 'Ошибка сервера при входе',
        ...(process.env.NODE_ENV === 'development' && { message: error instanceof Error ? error.message : String(error) }),
      },
      { status: 500 }
    );
  }
}

