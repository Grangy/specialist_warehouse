import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser, UserRole, verifyPassword } from './auth';
import { prisma } from './prisma';
import { checkRateLimit, getClientIdentifier } from './security/rateLimiter';
import { validateLogin, validatePassword } from './security/inputValidator';
import { logSecurityEvent } from './security/securityLogger';

export interface AuthRequest extends NextRequest {
  user?: {
    id: string;
    login: string;
    name: string;
    role: UserRole;
  };
}

export async function requireAuth(
  request: NextRequest,
  allowedRoles?: UserRole[]
): Promise<{ user: any } | NextResponse> {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: 'Требуется авторизация' },
      { status: 401 }
    );
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'Недостаточно прав доступа' },
      { status: 403 }
    );
  }

  return { user };
}

/**
 * Функция для проверки авторизации через заголовки, тело запроса или cookies
 * Поддерживает три способа авторизации:
 * 1. Заголовки X-Login и X-Password
 * 2. Логин и пароль в теле запроса (body.login и body.password)
 * 3. Cookies (через getSessionUser)
 */
export async function authenticateRequest(
  request: NextRequest,
  body: any,
  allowedRoles?: UserRole[]
): Promise<{ user: any } | NextResponse> {
  let login: string | null = null;
  let password: string | null = null;
  
  // Приоритет 1: Проверяем заголовки X-Login и X-Password
  const headerLogin = request.headers.get('x-login');
  const headerPassword = request.headers.get('x-password');
  
  if (headerLogin && headerPassword) {
    // Валидация логина и пароля из заголовков
    const loginValidation = validateLogin(headerLogin);
    const passwordValidation = validatePassword(headerPassword);
    
    if (!loginValidation.valid || !passwordValidation.valid) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
      logSecurityEvent('suspicious_activity', {
        ip,
        login: headerLogin,
        details: 'Invalid credentials format in headers',
      });
      return NextResponse.json(
        { error: 'Неверный формат учетных данных' },
        { status: 400 }
      );
    }
    
    login = loginValidation.sanitized!;
    password = headerPassword.trim();
    console.log('[API Auth] Используем авторизацию через заголовки X-Login/X-Password');
  }
  // Приоритет 2: Проверяем тело запроса (для обратной совместимости)
  else if (body && typeof body.login === 'string' && typeof body.password === 'string') {
    const loginValidation = validateLogin(body.login);
    const passwordValidation = validatePassword(body.password);
    
    if (!loginValidation.valid || !passwordValidation.valid) {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
      logSecurityEvent('suspicious_activity', {
        ip,
        login: body.login,
        details: 'Invalid credentials format in body',
      });
      return NextResponse.json(
        { error: 'Неверный формат учетных данных' },
        { status: 400 }
      );
    }
    
    if (loginValidation.sanitized && loginValidation.sanitized.length > 0 && body.password.length > 0) {
      login = loginValidation.sanitized;
      password = body.password.trim();
      console.log('[API Auth] Используем авторизацию через тело запроса (login/password)');
    }
  }
  
  // Если нашли credentials, проверяем их
  if (login && password) {
    // Rate limiting для аутентификации через заголовки/body ОТКЛЮЧЕН
    // const clientId = getClientIdentifier(request);
    // const rateLimit = checkRateLimit(`${clientId}:auth`, 'api');
    // if (!rateLimit.allowed) {
    //   const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    //   logSecurityEvent('rate_limit_exceeded', {
    //     ip,
    //     login,
    //     details: 'Authentication rate limit exceeded',
    //   });
    //   return NextResponse.json(
    //     { error: 'Слишком много запросов. Попробуйте позже.' },
    //     { 
    //       status: 429,
    //       headers: {
    //         'Retry-After': String(Math.ceil((rateLimit.resetTime - Date.now()) / 1000)),
    //       },
    //     }
    //   );
    // }

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

    // Проверяем роль пользователя, если указана
    if (allowedRoles && !allowedRoles.includes(user.role)) {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    return {
      user: {
        id: user.id,
        login: user.login,
        name: user.name,
        role: user.role,
      },
    };
  }

  // Иначе используем стандартную авторизацию через cookies
  console.log('[API Auth] Используем авторизацию через cookies');
  const user = await getSessionUser();

  if (!user) {
    console.log('[API Auth] Пользователь не найден в cookies');
    return NextResponse.json(
      { error: 'Требуется авторизация. Укажите заголовки X-Login и X-Password, или login/password в теле запроса, или авторизуйтесь через cookies' },
      { status: 401 }
    );
  }

  // Проверяем роль пользователя, если указана
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return NextResponse.json(
      { error: 'Недостаточно прав доступа' },
      { status: 403 }
    );
  }

  return { user };
}

export function canAccessTab(role: UserRole, tab: 'new' | 'processed'): boolean {
  if (role === 'admin') {
    return true;
  }
  if (role === 'collector') {
    return tab === 'new';
  }
  if (role === 'checker') {
    return tab === 'new' || tab === 'processed';
  }
  return false;
}

export function canAccessStatus(role: UserRole, status: string): boolean {
  if (role === 'admin') {
    return true;
  }
  if (role === 'collector') {
    return status === 'new';
  }
  if (role === 'checker') {
    return status === 'new' || status === 'pending_confirmation';
  }
  return false;
}

