/**
 * CSRF защита
 */

import { randomBytes } from 'crypto';
import { cookies } from 'next/headers';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_COOKIE = 'csrf_token';
const CSRF_TOKEN_HEADER = 'x-csrf-token';

/**
 * Генерация CSRF токена
 */
export function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Получение CSRF токена из cookie
 */
export async function getCsrfToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CSRF_TOKEN_COOKIE)?.value || null;
}

/**
 * Установка CSRF токена в cookie
 */
export async function setCsrfToken(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(CSRF_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60, // 24 часа
    path: '/',
  });
}

/**
 * Проверка CSRF токена
 */
export async function verifyCsrfToken(request: Request): Promise<boolean> {
  // GET запросы не требуют CSRF защиты
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') {
    return true;
  }

  const cookieToken = await getCsrfToken();
  const headerToken = request.headers.get(CSRF_TOKEN_HEADER);

  if (!cookieToken || !headerToken) {
    return false;
  }

  // Сравниваем токены безопасным способом (constant-time comparison)
  return constantTimeCompare(cookieToken, headerToken);
}

/**
 * Constant-time сравнение строк для защиты от timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

/**
 * Инициализация CSRF токена (вызывать при первом запросе)
 */
export async function initializeCsrfToken(): Promise<string> {
  let token = await getCsrfToken();
  
  if (!token) {
    token = generateCsrfToken();
    await setCsrfToken(token);
  }

  return token;
}
