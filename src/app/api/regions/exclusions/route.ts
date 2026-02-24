/**
 * Регионы, скрытые из списка выбора в админке.
 * GET — список скрытых регионов
 * POST — скрыть регион (body: { region })
 * DELETE — показать регион снова (query: region=...)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const list = await prisma.regionExclusion.findMany({
      select: { region: true },
      orderBy: { region: 'asc' },
    });
    return NextResponse.json(list.map((r) => r.region));
  } catch (error) {
    console.error('Ошибка при получении исключений регионов:', error);
    return NextResponse.json(
      { error: 'Ошибка сервера при получении исключений регионов' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json();
    const region = typeof body.region === 'string' ? body.region.trim() : null;
    if (!region) {
      return NextResponse.json({ error: 'Укажите region' }, { status: 400 });
    }

    await prisma.regionExclusion.upsert({
      where: { region },
      create: { region },
      update: {},
    });
    return NextResponse.json({ region });
  } catch (error) {
    console.error('Ошибка при добавлении исключения региона:', error);
    return NextResponse.json(
      { error: 'Ошибка при добавлении исключения региона' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region');
    if (!region) {
      return NextResponse.json({ error: 'Укажите region в query' }, { status: 400 });
    }

    await prisma.regionExclusion.deleteMany({
      where: { region },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Ошибка при удалении исключения региона:', error);
    return NextResponse.json(
      { error: 'Ошибка при удалении исключения региона' },
      { status: 500 }
    );
  }
}
