import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// GET - получить простой список всех пользователей (для выбора диктовщика)
// Доступен проверяльщикам и админам
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin', 'checker']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        login: true,
        name: true,
        role: true,
      },
      orderBy: {
        name: 'asc', // Сортируем по имени для удобства
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error('Ошибка при получении списка пользователей:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении списка пользователей' },
      { status: 500 }
    );
  }
}
