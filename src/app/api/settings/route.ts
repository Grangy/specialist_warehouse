import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings
 * Получение системных настроек
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только админ может получать настройки
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const settings = await prisma.systemSettings.findMany();
    
    // Преобразуем в объект для удобства
    const settingsMap: Record<string, any> = {};
    settings.forEach((setting) => {
      try {
        settingsMap[setting.key] = JSON.parse(setting.value);
      } catch {
        settingsMap[setting.key] = setting.value;
      }
    });

    return NextResponse.json({
      success: true,
      settings: settingsMap,
    });
  } catch (error) {
    console.error('[settings] Ошибка при получении настроек:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении настроек' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settings
 * Сохранение системных настроек
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;

    // Только админ может сохранять настройки
    if (user.role !== 'admin') {
      return NextResponse.json(
        { error: 'Недостаточно прав доступа' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { key, value } = body;

    if (!key) {
      return NextResponse.json(
        { error: 'Ключ настройки обязателен' },
        { status: 400 }
      );
    }

    // Преобразуем значение в строку (если это объект, то в JSON)
    const valueString = typeof value === 'string' ? value : JSON.stringify(value);

    // Создаем или обновляем настройку
    const setting = await prisma.systemSettings.upsert({
      where: { key },
      update: { value: valueString },
      create: { key, value: valueString },
    });

    return NextResponse.json({
      success: true,
      setting: {
        key: setting.key,
        value: typeof value === 'string' ? value : JSON.parse(setting.value),
      },
    });
  } catch (error) {
    console.error('[settings] Ошибка при сохранении настройки:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при сохранении настройки' },
      { status: 500 }
    );
  }
}
