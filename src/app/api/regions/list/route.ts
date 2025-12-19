import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

// GET - получить список всех уникальных регионов из заказов
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    // Получаем все уникальные регионы из заказов
    // ВАЖНО: Исключаем удаленные заказы
    const shipments = await prisma.shipment.findMany({
      where: {
        businessRegion: {
          not: null,
        },
        deleted: false, // Исключаем удаленные заказы
      },
      select: {
        businessRegion: true,
      },
      distinct: ['businessRegion'],
    });

    const regions = shipments
      .map((s) => s.businessRegion)
      .filter((r): r is string => r !== null);

    // Получаем существующие приоритеты
    let priorities: Array<{ region: string }> = [];
    try {
      priorities = await prisma.regionPriority.findMany({
        select: {
          region: true,
        },
      });
    } catch (dbError: any) {
      // Если таблица не существует, используем пустой массив
      if (dbError.code === 'P2021' || dbError.message?.includes('does not exist')) {
        console.warn('Таблица region_priorities не существует, используем пустой массив');
        priorities = [];
      } else {
        throw dbError;
      }
    }

    const existingRegions = new Set(priorities.map((p) => p.region));

    // Разделяем на существующие и новые
    const result = {
      all: regions,
      withPriority: priorities.map((p) => p.region),
      withoutPriority: regions.filter((r) => !existingRegions.has(r)),
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('Ошибка при получении списка регионов:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении списка регионов' },
      { status: 500 }
    );
  }
}

