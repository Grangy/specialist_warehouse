'use client';

import { useState, useEffect } from 'react';

export type ExtraWorkTimerSession = {
  id: string;
  status: string;
  /** Совпадает с computeExtraWorkElapsedSecNow на сервере в момент ответа */
  elapsedSecNow?: number;
  startedAt: string;
  postLunchStartedAt?: string | null;
  elapsedSecBeforeLunch?: number;
};

function legacyElapsedSec(session: ExtraWorkTimerSession, nowMs: number): number {
  const baseSec = Math.max(0, session.elapsedSecBeforeLunch ?? 0);
  const segStart = session.postLunchStartedAt
    ? new Date(session.postLunchStartedAt).getTime()
    : new Date(session.startedAt).getTime();
  if (session.status === 'lunch') return baseSec;
  if (session.status !== 'running' && session.status !== 'lunch_scheduled') return baseSec;
  return baseSec + Math.max(0, (nowMs - segStart) / 1000);
}

/**
 * Якорь на серверном elapsedSecNow + локальная дельта между опросами (без скачков от heal).
 */
export function useExtraWorkTimerDisplay(session: ExtraWorkTimerSession | null): number {
  const [displaySec, setDisplaySec] = useState(0);

  useEffect(() => {
    if (!session) {
      queueMicrotask(() => setDisplaySec(0));
      return;
    }

    const anchorSec =
      typeof session.elapsedSecNow === 'number'
        ? Math.max(0, session.elapsedSecNow)
        : legacyElapsedSec(session, Date.now());

    if (session.status !== 'running' && session.status !== 'lunch_scheduled') {
      queueMicrotask(() => setDisplaySec(anchorSec));
      return;
    }

    const syncedAtMs = Date.now();
    const tick = () => Math.max(0, anchorSec + (Date.now() - syncedAtMs) / 1000);
    queueMicrotask(() => setDisplaySec(tick()));
    const id = setInterval(() => setDisplaySec(tick()), 1000);
    return () => clearInterval(id);
  }, [session]);

  return displaySec;
}
