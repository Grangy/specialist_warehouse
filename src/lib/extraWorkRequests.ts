import { PrismaClient } from '@/generated/prisma/client';

export const EXTRA_WORK_REQUESTS_SETTINGS_KEY = 'extra_work_requests_queue_v1';

export type ExtraWorkRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ExtraWorkRequestItem {
  id: string;
  requesterId: string;
  requesterName: string;
  requestedTask: string;
  createdAt: string;
  status: ExtraWorkRequestStatus;
  handledAt?: string;
  handledById?: string;
  handledByName?: string;
  note?: string;
}

function safeParseRequests(raw: string | null | undefined): ExtraWorkRequestItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is ExtraWorkRequestItem => {
      if (!x || typeof x !== 'object') return false;
      const obj = x as Record<string, unknown>;
      return (
        typeof obj.id === 'string' &&
        typeof obj.requesterId === 'string' &&
        typeof obj.requesterName === 'string' &&
        typeof obj.requestedTask === 'string' &&
        typeof obj.createdAt === 'string' &&
        (obj.status === 'pending' || obj.status === 'approved' || obj.status === 'rejected')
      );
    });
  } catch {
    return [];
  }
}

export async function loadExtraWorkRequests(prisma: PrismaClient): Promise<ExtraWorkRequestItem[]> {
  const row = await prisma.systemSettings.findUnique({
    where: { key: EXTRA_WORK_REQUESTS_SETTINGS_KEY },
    select: { value: true },
  });
  return safeParseRequests(row?.value);
}

export async function saveExtraWorkRequests(prisma: PrismaClient, requests: ExtraWorkRequestItem[]): Promise<void> {
  await prisma.systemSettings.upsert({
    where: { key: EXTRA_WORK_REQUESTS_SETTINGS_KEY },
    update: { value: JSON.stringify(requests) },
    create: { key: EXTRA_WORK_REQUESTS_SETTINGS_KEY, value: JSON.stringify(requests) },
  });
}

