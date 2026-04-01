'use client';

import { useEffect } from 'react';
import { useExtraWork } from '@/contexts/ExtraWorkContext';

/**
 * Единственный набор POST-интервалов для доп. работы (обед по расписанию, выход с обеда, автостоп).
 * Раньше дублировался в ExtraWorkBanner и ExtraWorkPopup — удвоение запросов к API.
 */
export function ExtraWorkSessionEffects() {
  const { session, refetchSession } = useExtraWork();

  useEffect(() => {
    if (!session || session.status !== 'lunch_scheduled' || !session.lunchScheduledFor) return;
    const scheduledFor = new Date(session.lunchScheduledFor).getTime();
    const check = () => {
      if (Date.now() >= scheduledFor) {
        fetch('/api/extra-work/start-scheduled-lunch', { method: 'POST' })
          .then((res) => res.ok && res.json())
          .then(() => {
            void refetchSession();
          });
      }
    };
    check();
    const id = setInterval(check, 3000);
    return () => clearInterval(id);
  }, [session, session?.id, session?.status, session?.lunchScheduledFor, refetchSession]);

  useEffect(() => {
    if (!session || session.status !== 'lunch' || !session.lunchEndsAt) return;
    const endsAt = new Date(session.lunchEndsAt).getTime();
    const check = () => {
      if (Date.now() >= endsAt) {
        fetch('/api/admin/extra-work/resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        }).then(() => {
          void refetchSession();
        });
      }
    };
    const id = setInterval(check, 5000);
    return () => clearInterval(id);
  }, [session, session?.id, session?.status, session?.lunchEndsAt, refetchSession]);

  useEffect(() => {
    if (!session || session.status === 'lunch' || !session.durationMinutes) return;
    const baseSec = session.elapsedSecBeforeLunch ?? 0;
    const segStart = session.postLunchStartedAt
      ? new Date(session.postLunchStartedAt).getTime()
      : new Date(session.startedAt).getTime();
    const currentElapsedSec =
      session.status === 'running'
        ? baseSec + Math.max(0, (Date.now() - segStart) / 1000)
        : baseSec;
    const endAt = Date.now() + Math.max(0, session.durationMinutes * 60 - currentElapsedSec) * 1000;
    const check = () => {
      if (Date.now() >= endAt) {
        fetch('/api/admin/extra-work/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id }),
        }).then(() => {
          void refetchSession();
        });
      }
    };
    const id = setInterval(check, 10000);
    return () => clearInterval(id);
  }, [session, session?.id, session?.status, session?.startedAt, session?.durationMinutes, refetchSession]);

  return null;
}
