import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { hashPassword } from '@/lib/auth';

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

    return NextResponse.json(users);
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

