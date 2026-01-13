import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { hashPassword } from '@/lib/auth';
import { getAnimalLevel } from '@/lib/ranking/levels';

export const dynamic = 'force-dynamic';

// GET - получить список пользователей (только для админа)
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        login: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Получаем текущую дату
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    // Получаем статистику для каждого пользователя
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        let dailyStats = null;
        let monthlyStats = null;

        try {
          if ('dailyStats' in prisma && typeof (prisma as any).dailyStats?.findUnique === 'function') {
            dailyStats = await (prisma as any).dailyStats.findUnique({
              where: {
                userId_date: {
                  userId: user.id,
                  date: today,
                },
              },
            });
          }
        } catch (error: any) {
          // Модель еще не доступна
        }

        try {
          if ('monthlyStats' in prisma && typeof (prisma as any).monthlyStats?.findUnique === 'function') {
            monthlyStats = await (prisma as any).monthlyStats.findUnique({
              where: {
                userId_year_month: {
                  userId: user.id,
                  year: currentYear,
                  month: currentMonth,
                },
              },
            });
          }
        } catch (error: any) {
          // Модель еще не доступна
        }

        const dailyLevel = dailyStats?.dailyRank ? getAnimalLevel(dailyStats.dailyRank) : null;
        const monthlyLevel = monthlyStats?.monthlyRank ? getAnimalLevel(monthlyStats.monthlyRank) : null;

        return {
          ...user,
          dailyRank: dailyStats?.dailyRank || null,
          dailyLevel: dailyLevel ? {
            name: dailyLevel.name,
            emoji: dailyLevel.emoji,
            color: dailyLevel.color,
          } : null,
          dailyPoints: dailyStats?.dayPoints || null,
          monthlyRank: monthlyStats?.monthlyRank || null,
          monthlyLevel: monthlyLevel ? {
            name: monthlyLevel.name,
            emoji: monthlyLevel.emoji,
            color: monthlyLevel.color,
          } : null,
          monthlyPoints: monthlyStats?.monthPoints || null,
        };
      })
    );

    return NextResponse.json(usersWithStats);
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении пользователей' },
      { status: 500 }
    );
  }
}

// POST - создать пользователя (только для админа)
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { login, password, name, role } = await request.json();

    if (!login || !password || !name || !role) {
      return NextResponse.json(
        { error: 'Все поля обязательны' },
        { status: 400 }
      );
    }

    if (!['admin', 'collector', 'checker'].includes(role)) {
      return NextResponse.json(
        { error: 'Неверная роль' },
        { status: 400 }
      );
    }

    // Проверяем, существует ли пользователь с таким логином
    const existingUser = await prisma.user.findUnique({
      where: { login },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким логином уже существует' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        login,
        password: hashedPassword,
        name,
        role: role as 'admin' | 'collector' | 'checker',
      },
      select: {
        id: true,
        login: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(user, { status: 201 });
  } catch (error) {
    console.error('Ошибка при создании пользователя:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при создании пользователя' },
      { status: 500 }
    );
  }
}

