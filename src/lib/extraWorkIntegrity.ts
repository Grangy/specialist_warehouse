import type { prisma } from '@/lib/prisma';

type PrismaLike = typeof prisma;

/**
 * Инвариант: если stoppedAt задан, сессия должна быть status='stopped'.
 *
 * Исторически могли появиться записи с stoppedAt != null и status='running' (или 'lunch*'),
 * из‑за чего они не попадали в агрегации (которые фильтруют stopped).
 *
 * Эта функция безопасно чинит такие записи одним UPDATE.
 */
export async function healExtraWorkStoppedInvariant(db: PrismaLike): Promise<number> {
  const res = await db.extraWorkSession.updateMany({
    where: {
      stoppedAt: { not: null },
      status: { not: 'stopped' },
    },
    data: { status: 'stopped' },
  });
  return res.count ?? 0;
}

