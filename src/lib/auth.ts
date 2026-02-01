import { prisma } from './prisma';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';

export type UserRole = 'admin' | 'collector' | 'checker';

export interface SessionUser {
  id: string;
  login: string;
  name: string;
  role: UserRole;
}

// Уменьшена длительность сессии для безопасности: с 7 дней до 24 часов
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 часа

// Кэш сессии в памяти (TTL 60 сек) — снижает нагрузку на БД при частых запросах (поллинг)
const SESSION_CACHE_TTL_MS = 60 * 1000;
const sessionCache = new Map<string, { user: SessionUser; expiry: number }>();

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DURATION);

  await prisma.session.create({
    data: {
      userId,
      token,
      expiresAt,
    },
  });

  return token;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('session_token')?.value;

    if (!token) return null;

    const now = Date.now();
    const cached = sessionCache.get(token);
    if (cached && cached.expiry > now) return cached.user;
    // Очищаем устаревшие записи при промахе кэша
    for (const [k, v] of sessionCache.entries()) {
      if (v.expiry <= now) sessionCache.delete(k);
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: {
        user: true,
      },
    });

    if (!session || session.expiresAt < new Date()) {
      sessionCache.delete(token);
      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
      }
      return null;
    }

    if (!session.user) {
      return null;
    }

    const user: SessionUser = {
      id: session.user.id,
      login: session.user.login,
      name: session.user.name,
      role: session.user.role as UserRole,
    };
    sessionCache.set(token, { user, expiry: Date.now() + SESSION_CACHE_TTL_MS });
    return user;
  } catch (error) {
    console.error('Ошибка при получении сессии:', error);
    return null;
  }
}

export async function deleteSession(token: string): Promise<void> {
  sessionCache.delete(token);
  await prisma.session.deleteMany({
    where: { token },
  });
}

export async function cleanupExpiredSessions(): Promise<void> {
  await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });
}

