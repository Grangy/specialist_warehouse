import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/middleware';
import {
  explainAutoProcessMatch,
  getAdminAutoProcessPatternsNormalized,
  normalizeCustomerNameForMatch,
  normalizePatternsForStorage,
  textToPatternLines,
} from '@/lib/autoProcessCustomers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/auto-process-customers/dry-run
 * Body: { patternsText?: string, customerNamesText: string }
 * — если patternsText не передан, берутся сохранённые паттерны из БД;
 * — customerNamesText: по одному имени клиента на строку.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth(request, ['admin']);
    if (authResult instanceof NextResponse) return authResult;

    const body = await request.json().catch(() => ({}));
    const customerNamesText = typeof body.customerNamesText === 'string' ? body.customerNamesText : '';
    const names = textToPatternLines(customerNamesText);
    if (names.length === 0) {
      return NextResponse.json(
        { error: 'Укажите customerNamesText — имена клиентов по одному на строку.' },
        { status: 400 }
      );
    }
    if (names.length > 500) {
      return NextResponse.json({ error: 'Не больше 500 строк для проверки.' }, { status: 400 });
    }

    let patternsNorm: string[];
    if (typeof body.patternsText === 'string' && body.patternsText.trim()) {
      patternsNorm = normalizePatternsForStorage(textToPatternLines(body.patternsText)).map((p) =>
        normalizeCustomerNameForMatch(p)
      );
    } else {
      patternsNorm = await getAdminAutoProcessPatternsNormalized(prisma);
    }

    const rows = names.map((name) => {
      const ex = explainAutoProcessMatch(name, patternsNorm);
      return {
        customerName: name,
        wouldAutoProcess: ex.matched,
        viaOptovik: ex.viaOptovik,
        matchedAdminPatterns: ex.matchedPatterns,
      };
    });

    return NextResponse.json({
      dryRun: true,
      patternsUsedCount: patternsNorm.length,
      rows,
      summary: {
        total: rows.length,
        wouldProcess: rows.filter((r) => r.wouldAutoProcess).length,
      },
    });
  } catch (e) {
    console.error('[admin/auto-process-customers/dry-run]', e);
    return NextResponse.json({ error: 'Ошибка' }, { status: 500 });
  }
}
