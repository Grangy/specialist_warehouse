/**
 * Публичный API: общий топ без авторизации
 * GET /api/statistics/top?period=today|week|month — объединённый рейтинг за период (Москва).
 * today = день с утра, week = с понедельника, month = с начала месяца.
 *
 * Тяжёлый расчёт кэшируется в памяти процесса; фоновое прогревание — см. @/lib/statistics/topResponseCache.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import {
  getTopCachedOrCompute,
  getTopCachedOrComputeWithDebug,
  buildTopPayloadWithDebug,
  recomputeTopAndCache,
  setTopCache,
  type TopPeriod,
} from '@/lib/statistics/topResponseCache';
import { checkRateLimit, getClientIdentifier } from '@/lib/security/rateLimiter';
import { aggregateRankings } from '@/lib/statistics/aggregateRankings';
import { getAnimalLevel } from '@/lib/ranking/levels';

function computeWeakEtag(input: string): string {
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `W/"${hash}"`;
}

function parseArchiveMonth(v: string | null): string | null {
  if (!v) return null;
  const m = v.trim().match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** Ответ из снимка БД — быстрый; legacy-расчёт в запросе только при dev. */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const { allowed, resetTime } = checkRateLimit(getClientIdentifier(request), 'publicStats');
    if (!allowed) {
      return NextResponse.json(
        { error: 'Слишком много запросов к топу. Подождите немного.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
          },
        }
      );
    }

    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get('period') || 'today';
    const period: TopPeriod =
      periodParam === 'week' || periodParam === 'month' ? periodParam : 'today';
    const warehouseFilter = searchParams.get('warehouse') || undefined;
    const archiveMonth = period === 'month' ? parseArchiveMonth(searchParams.get('month')) : null;

    const debug = searchParams.get('debug') === '1' || searchParams.get('debug') === 'true';
    if (debug) {
      const nocache = searchParams.get('nocache') === '1' || searchParams.get('nocache') === 'true';
      if (nocache) {
        const { body, debug: dbg } = await buildTopPayloadWithDebug(period, warehouseFilter, { forceCompute: true });
        // Чтобы обычный GET (без debug) тоже начал отдавать актуальные данные.
        setTopCache(period, warehouseFilter, body);
        return NextResponse.json(
          {
            ...body,
            debug: dbg,
          },
          {
            headers: {
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'X-Top-Cache': 'MISS',
              'X-Top-Debug': JSON.stringify(dbg),
            },
          }
        );
      }

      const { body, xTopCache, debug: dbg } = await getTopCachedOrComputeWithDebug(period, warehouseFilter);
      return NextResponse.json(
        {
          ...body,
          debug: dbg,
        },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Top-Cache': xTopCache,
            'X-Top-Debug': JSON.stringify(dbg),
          },
        }
      );
    }

    // Archive month mode: bypass top cache, compute exact month snapshot.
    if (archiveMonth) {
      const { allRankings: rawList, errorsByCollector, errorsByChecker, baselineUserName } = await aggregateRankings(
        'month',
        warehouseFilter,
        undefined,
        archiveMonth
      );
      const allRankings = rawList.map((e) => ({ ...e }));

      const allPoints = allRankings.map((s) => s.points).filter((p) => p > 0);
      if (allPoints.length > 0) {
        const sorted = [...allPoints].sort((a, b) => a - b);
        const percentiles = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((p) => sorted[Math.floor(sorted.length * p)]);
        for (const entry of allRankings) {
          let rank = 10;
          for (let i = 0; i < percentiles.length; i++) {
            if (entry.points <= percentiles[i]) {
              rank = i + 1;
              break;
            }
          }
          entry.rank = rank;
          const level = getAnimalLevel(rank);
          entry.level = level ? { name: level.name, emoji: level.emoji, color: level.color } : null;
        }
      }

      const topErrorsMerged = [...allRankings]
        .filter((e) => (e.errors + e.checkerErrors) > 0)
        .sort((a, b) => b.errors + b.checkerErrors - (a.errors + a.checkerErrors))
        .slice(0, 10)
        .map((e) => ({
          userId: e.userId,
          userName: e.userName,
          errors: e.errors,
          checkerErrors: e.checkerErrors,
          total: e.errors + e.checkerErrors,
        }));
      const totalCollectorErrors = [...errorsByCollector.values()].reduce((a, b) => a + b, 0);
      const totalCheckerErrors = [...errorsByChecker.values()].reduce((a, b) => a + b, 0);

      return NextResponse.json(
        {
          all: allRankings,
          period,
          month: archiveMonth,
          date: `${archiveMonth}-01`,
          totalCollectorErrors,
          totalCheckerErrors,
          topErrorsMerged,
          baselineUserName,
        },
        { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'X-Top-Archive-Month': archiveMonth } }
      );
    }

    const nocache = searchParams.get('nocache') === '1' || searchParams.get('nocache') === 'true';
    if (nocache) {
      /**
       * Важно: `nocache=1` должен обходить только in-memory кэш top (TOP_CACHE_TTL),
       * но НЕ форсировать legacy compute aggregateRankings, иначе под нагрузкой
       * это превращается в ~секунды CPU/SQLite на каждый запрос и легко «кладёт» сервер.
       *
       * Для принудительного тяжёлого пересчёта используйте debug-режим/отдельные админские инструменты,
       * но публичный `nocache=1` остаётся безопасным.
       */
      const { body } = await recomputeTopAndCache(period, warehouseFilter);
      const etag = computeWeakEtag(JSON.stringify(body));
      const inm = request.headers.get('if-none-match');
      if (inm && inm === etag) {
        return new NextResponse(null, {
          status: 304,
          headers: new Headers({
            etag,
            'cache-control': 'no-store, no-cache, must-revalidate',
            'x-top-cache': 'MISS',
          }),
        });
      }
      return NextResponse.json(body, {
        headers: new Headers({
          etag,
          'cache-control': 'no-store, no-cache, must-revalidate',
          'x-top-cache': 'MISS',
        }),
      });
    }

    const { body, xTopCache } = await getTopCachedOrCompute(period, warehouseFilter);
    const etag = computeWeakEtag(JSON.stringify(body));
    const inm = request.headers.get('if-none-match');
    if (inm && inm === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: new Headers({
          etag,
          'cache-control': 'no-store, no-cache, must-revalidate',
          'x-top-cache': xTopCache,
        }),
      });
    }
    return NextResponse.json(body, {
      headers: new Headers({
        etag,
        'cache-control': 'no-store, no-cache, must-revalidate',
        'x-top-cache': xTopCache,
      }),
    });
  } catch (error: unknown) {
    console.error('[API Statistics Top] Ошибка:', error);
    return NextResponse.json(
      {
        error: 'Ошибка получения рейтинга',
        ...(process.env.NODE_ENV === 'development' && {
          details: error instanceof Error ? error.message : String(error),
        }),
      },
      { status: 500 }
    );
  }
}
