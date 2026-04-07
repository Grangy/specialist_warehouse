/** Ключ in-memory кэша детальной статистики пользователя (без Prisma). */
export function getUserStatsCacheKey(
  userId: string,
  period?: 'today' | 'week' | 'month',
  dateOverride?: string,
  monthOverride?: string
): string {
  return `${userId}:${period ?? ''}:${dateOverride ?? ''}:${monthOverride ?? ''}`;
}
