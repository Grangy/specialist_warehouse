/**
 * Rate Limiter для защиты от brute force атак
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
  blocked: boolean;
  blockUntil?: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Настройки rate limiting
const RATE_LIMIT_CONFIG = {
  // Логин: максимум 5 попыток за 15 минут
  login: {
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000, // 15 минут
    blockDurationMs: 30 * 60 * 1000, // Блокировка на 30 минут после превышения
  },
  // API запросы: максимум 100 запросов за минуту
  api: {
    maxAttempts: 100,
    windowMs: 60 * 1000, // 1 минута
    blockDurationMs: 5 * 60 * 1000, // Блокировка на 5 минут
  },
  // Общие запросы: максимум 200 запросов за минуту
  general: {
    maxAttempts: 200,
    windowMs: 60 * 1000, // 1 минута
    blockDurationMs: 5 * 60 * 1000,
  },
};

export function checkRateLimit(
  identifier: string,
  type: 'login' | 'api' | 'general' = 'general'
): { allowed: boolean; remaining: number; resetTime: number } {
  const config = RATE_LIMIT_CONFIG[type];
  const now = Date.now();
  const key = `${type}:${identifier}`;

  let entry = rateLimitStore.get(key);

  // Если запись не существует или окно истекло, создаем новую
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
      blocked: false,
    };
  }

  // Проверяем, не заблокирован ли идентификатор
  if (entry.blocked && entry.blockUntil && entry.blockUntil > now) {
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.blockUntil,
    };
  }

  // Если блокировка истекла, снимаем её
  if (entry.blocked && entry.blockUntil && entry.blockUntil <= now) {
    entry.blocked = false;
    entry.count = 0;
    entry.resetTime = now + config.windowMs;
  }

  // Увеличиваем счетчик
  entry.count++;

  // Если превышен лимит, блокируем
  if (entry.count > config.maxAttempts) {
    entry.blocked = true;
    entry.blockUntil = now + config.blockDurationMs;
    rateLimitStore.set(key, entry);
    return {
      allowed: false,
      remaining: 0,
      resetTime: entry.blockUntil,
    };
  }

  rateLimitStore.set(key, entry);

  return {
    allowed: true,
    remaining: Math.max(0, config.maxAttempts - entry.count),
    resetTime: entry.resetTime,
  };
}

export function getClientIdentifier(request: Request): string {
  // Используем IP адрес или комбинацию IP + User-Agent
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : 'unknown';
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  // Для логина используем только IP, для API - IP + путь
  return `${ip}:${userAgent.substring(0, 50)}`;
}

// Очистка старых записей (вызывать периодически)
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    // Удаляем записи, которые истекли и не заблокированы
    if (entry.resetTime < now && !entry.blocked) {
      rateLimitStore.delete(key);
    }
    // Удаляем записи с истекшей блокировкой
    if (entry.blocked && entry.blockUntil && entry.blockUntil < now) {
      rateLimitStore.delete(key);
    }
  }
}

// Запускаем очистку каждые 5 минут
if (typeof setInterval !== 'undefined') {
  setInterval(cleanupRateLimitStore, 5 * 60 * 1000);
}
