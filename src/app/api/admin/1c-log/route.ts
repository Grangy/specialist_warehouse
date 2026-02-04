/**
 * GET /api/admin/1c-log
 * Аудит лога обмена с 1С. Только для админа.
 *
 * Query:
 * - date=YYYY-MM-DD — за какую дату (по умолчанию сегодня)
 * - tail=N — последние N строк (по умолчанию 500, макс 5000)
 * - list=1 — вернуть только список доступных дат (игнорирует date/tail)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/middleware';
import { read1cLog, list1cLogDates } from '@/lib/1cLog';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }
    const { user } = authResult;
    if (user.role !== 'admin') {
      return NextResponse.json({ error: 'Доступ только для администратора' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const listOnly = searchParams.get('list') === '1';

    if (listOnly) {
      const dates = list1cLogDates();
      return NextResponse.json({ dates });
    }

    const date = searchParams.get('date') || undefined;
    const tailParam = searchParams.get('tail');
    const tail = tailParam ? Math.min(5000, Math.max(1, parseInt(tailParam, 10) || 500)) : 500;

    const { lines, path: logPath } = read1cLog({ date, tail });

    const parsed = lines.map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return { raw: line };
      }
    });

    return NextResponse.json({
      date: date || new Date().toISOString().slice(0, 10),
      path: logPath,
      count: parsed.length,
      entries: parsed,
    });
  } catch (error: unknown) {
    console.error('[API admin/1c-log]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Ошибка чтения лога' },
      { status: 500 }
    );
  }
}
