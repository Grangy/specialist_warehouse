/**
 * Проверка, является ли сборщик новичком (для сниженных штрафов).
 * isNewbie хранится в UserSettings.settings JSON.
 */

import { prisma } from '@/lib/prisma';

export async function isCollectorNewbie(collectorId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId: collectorId },
  });
  if (!row?.settings) return false;
  try {
    const parsed = JSON.parse(row.settings) as Record<string, unknown>;
    return parsed.isNewbie === true;
  } catch {
    return false;
  }
}
