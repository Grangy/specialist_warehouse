import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import {
  AUTO_PROCESS_CUSTOMER_PATTERNS_KEY,
  clearAutoProcessCustomerPatternsCache,
  normalizePatternsForStorage,
  parsePatternsFromSettingsRaw,
  patternsToDisplayText,
  textToPatternLines,
} from '@/lib/autoProcessCustomers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const row = await prisma.systemSettings.findUnique({
      where: { key: AUTO_PROCESS_CUSTOMER_PATTERNS_KEY },
    });
    const patterns = parsePatternsFromSettingsRaw(row?.value ?? null);
    return NextResponse.json({
      patterns,
      text: patternsToDisplayText(patterns),
      builtinOptovik: true,
      hint:
        'Одна строка — одна подстрока поиска в имени клиента (без учёта регистра). Встроенно всегда: «ОПТОВИК».',
    });
  } catch (e) {
    console.error('[admin/auto-process-customers GET]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json().catch(() => ({}));
    const text = typeof body.text === 'string' ? body.text : '';
    const fromArray = Array.isArray(body.patterns) ? body.patterns.map((x: unknown) => String(x)) : null;
    const lines = fromArray ?? textToPatternLines(text);
    const patterns = normalizePatternsForStorage(lines);

    await prisma.systemSettings.upsert({
      where: { key: AUTO_PROCESS_CUSTOMER_PATTERNS_KEY },
      create: { key: AUTO_PROCESS_CUSTOMER_PATTERNS_KEY, value: JSON.stringify({ patterns }) },
      update: { value: JSON.stringify({ patterns }) },
    });
    clearAutoProcessCustomerPatternsCache();

    return NextResponse.json({
      success: true,
      patterns,
      text: patternsToDisplayText(patterns),
    });
  } catch (e) {
    console.error('[admin/auto-process-customers PUT]', e);
    return NextResponse.json({ error: 'Ошибка сохранения' }, { status: 500 });
  }
}
