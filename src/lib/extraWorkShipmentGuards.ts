/**
 * Ограничения на сборку/проверку при активной доп. работе.
 * — Сборщик: можно дособрать только свою заявку («На руках»).
 * — Проверяльщик: новую проверку взять нельзя; текущую — можно завершить.
 */

import { prisma } from '@/lib/prisma';

export const ACTIVE_EXTRA_WORK_STATUSES = ['running', 'lunch', 'lunch_scheduled'] as const;

export type TaskForExtraWorkGuard = {
  collectorId: string | null;
  checkerId: string | null;
  checkerStartedAt: Date | null;
  status: string;
  lines?: Array<{ confirmed: boolean; confirmedQty: number | null }>;
};

export function hasCheckerVerificationStarted(task: TaskForExtraWorkGuard): boolean {
  if (task.checkerId != null) return true;
  if (task.checkerStartedAt != null) return true;
  return (
    task.lines?.some((l) => l.confirmed || (l.confirmedQty != null && l.confirmedQty > 0)) ?? false
  );
}

/** Сборщик продолжает своё задание (вкладка «На руках»). */
export function canCollectorResumeOwnTaskDuringExtraWork(
  task: Pick<TaskForExtraWorkGuard, 'collectorId'>,
  userId: string
): boolean {
  return task.collectorId === userId;
}

/** Проверяльщик уже начал проверку этого задания — можно довести до конца. */
export function canCheckerContinueVerificationDuringExtraWork(
  task: TaskForExtraWorkGuard,
  userId: string
): boolean {
  if (!hasCheckerVerificationStarted(task)) return false;
  if (task.checkerId != null && task.checkerId !== userId) return false;
  return true;
}

export type ExtraWorkShipmentAction = 'lock' | 'verify';

export function getExtraWorkShipmentBlockReason(params: {
  userRole: string;
  userId: string;
  task: TaskForExtraWorkGuard;
  action: ExtraWorkShipmentAction;
}): 'collector_new' | 'checker_new' | 'generic' | null {
  if (params.userRole === 'admin') return null;

  if (params.action === 'lock') {
    if (canCollectorResumeOwnTaskDuringExtraWork(params.task, params.userId)) return null;
    return 'collector_new';
  }

  if (params.userRole === 'checker' || params.userRole === 'warehouse_3') {
    if (canCheckerContinueVerificationDuringExtraWork(params.task, params.userId)) return null;
    return 'checker_new';
  }

  return 'generic';
}

export function extraWorkShipmentBlockMessage(
  reason: 'collector_new' | 'checker_new' | 'generic'
): string {
  switch (reason) {
    case 'collector_new':
      return 'Дополнительная работа активна. Можно только дособрать свою заявку из «На руках».';
    case 'checker_new':
      return 'Дополнительная работа активна. Новую проверку взять нельзя — завершите текущую.';
    default:
      return 'Дополнительная работа активна. Остановите таймер.';
  }
}

type PrismaLike = typeof prisma;

/** Проверка доп. работы для API-маршрутов. null = разрешено. */
export async function getExtraWorkShipmentBlockResponse(
  prismaClient: PrismaLike,
  user: { id: string; role: string },
  task: TaskForExtraWorkGuard,
  action: ExtraWorkShipmentAction
): Promise<{ error: string; code: string } | null> {
  const activeExtraWork = await prismaClient.extraWorkSession.findFirst({
    where: {
      userId: user.id,
      status: { in: [...ACTIVE_EXTRA_WORK_STATUSES] },
      stoppedAt: null,
    },
    select: { id: true },
  });
  if (!activeExtraWork) return null;

  const reason = getExtraWorkShipmentBlockReason({
    userRole: user.role,
    userId: user.id,
    task,
    action,
  });
  if (!reason) return null;

  return {
    error: extraWorkShipmentBlockMessage(reason),
    code: reason === 'checker_new' ? 'EXTRA_WORK_CHECKER_NEW' : 'EXTRA_WORK_ACTIVE',
  };
}
