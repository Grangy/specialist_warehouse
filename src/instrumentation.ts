/**
 * Ранняя загрузка кэша агрегатов на старте Node-процесса (диск + фоновый прогрев).
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('@/lib/statistics/statsAggregateCache');
  }
}
