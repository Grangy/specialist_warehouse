import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import { hashPassword } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// DELETE - удалить пользователя (только для админа)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    // Нельзя удалить самого себя
    if (id === authResult.user.id) {
      return NextResponse.json(
        { error: 'Нельзя удалить самого себя' },
        { status: 400 }
      );
    }

    await prisma.user.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Ошибка при удалении пользователя:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при удалении пользователя' },
      { status: 500 }
    );
  }
}

// PATCH - обновить пользователя (только для админа)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const body = await request.json();
    const { login, password, name, role } = body;

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (role !== undefined) {
      if (!['admin', 'collector', 'checker'].includes(role)) {
        return NextResponse.json(
          { error: 'Неверная роль' },
          { status: 400 }
        );
      }
      updateData.role = role;
    }
    if (login !== undefined) {
      // Проверяем, не занят ли логин другим пользователем
      const existingUser = await prisma.user.findUnique({
        where: { login },
      });
      if (existingUser && existingUser.id !== id) {
        return NextResponse.json(
          { error: 'Пользователь с таким логином уже существует' },
          { status: 409 }
        );
      }
      updateData.login = login;
    }
    if (password !== undefined && password !== '') {
      updateData.password = await hashPassword(password);
    }

    const user = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        login: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error('Ошибка при обновлении пользователя:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при обновлении пользователя' },
      { status: 500 }
    );
  }
}

