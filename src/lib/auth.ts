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

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 дней

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

    if (!token) {
      return null;
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { 
        user: true 
      },
    });

    if (!session || session.expiresAt < new Date()) {
      // Удаляем истекшую сессию
      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
      }
      return null;
    }

    if (!session.user) {
      return null;
    }

    return {
      id: session.user.id,
      login: session.user.login,
      name: session.user.name,
      role: session.user.role as UserRole,
    };
  } catch (error) {
    console.error('Ошибка при получении сессии:', error);
    return null;
  }
}

export async function deleteSession(token: string): Promise<void> {
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

