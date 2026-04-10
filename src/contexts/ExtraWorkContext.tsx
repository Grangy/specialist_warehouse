'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';

const EXTRA_WORK_SOUND_URL = '/music/you-will-work.wav';

/** Без активной сессии — редкий опрос, чтобы не грузить API и CPU на проде */
const POLL_INTERVAL_IDLE_MS = 45_000;
/** При активной доп. работе — частый опрос таймера/обеда */
const POLL_INTERVAL_ACTIVE_MS = 5000;

export interface ExtraWorkSession {
  id: string;
  status: string;
  startedAt: string;
  completionType?: string | null;
  warehouse?: string | null;
  comment?: string | null;
  durationMinutes?: number | null;
  lunchSlot?: string | null;
  lunchScheduledFor?: string | null;
  lunchStartedAt?: string | null;
  lunchEndsAt?: string | null;
  /** После обеда — начало сегмента «после обеда» (иначе таймер считать от startedAt неверно) */
  postLunchStartedAt?: string | null;
  elapsedSecBeforeLunch: number;
  ratePerHour?: number;
  dayCoefficient?: number;
  /** Баллы по формуле сервера (как рейтинг / админка), не elapsed×rate */
  farmedPoints?: number;
  /** Рабочие секунды «сейчас» с сервера (для стабильного таймера) */
  elapsedSecNow?: number;
  pointsSyncedAt?: string;
}

interface ExtraWorkContextType {
  session: ExtraWorkSession | null;
  popupOpen: boolean;
  setPopupOpen: (v: boolean) => void;
  refetchSession: () => Promise<void>;
}

const ExtraWorkContext = createContext<ExtraWorkContextType | undefined>(undefined);

export function ExtraWorkProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { showToast } = useToastContext();
  const [session, setSession] = useState<ExtraWorkSession | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const prevSessionId = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/extra-work/my-session', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          const isNewSession = prevSessionId.current !== data.id;
          const startedRecently =
            data.startedAt && Date.now() - new Date(data.startedAt).getTime() < 120_000;
          setSession(data);
          prevSessionId.current = data.id;
          if (isNewSession && startedRecently) {
            setPopupOpen(true);
            showToast('Дополнительная работа начата', 'success', 4500);
            try {
              const audio = new Audio(EXTRA_WORK_SOUND_URL);
              audio.volume = 1;
              audio.play().catch(() => {});
            } catch {
              // ignore sound errors
            }
          }
        } else {
          setSession(null);
          prevSessionId.current = null;
        }
      }
    } catch {
      // ignore
    }
  }, [showToast]);

  const pollExtraWork = pathname !== '/login';

  useEffect(() => {
    if (pathname === '/login') {
      queueMicrotask(() => {
        setSession(null);
        prevSessionId.current = null;
      });
    }
  }, [pathname]);

  useEffect(() => {
    if (!pollExtraWork) return;
    queueMicrotask(() => load());
    const ms = session ? POLL_INTERVAL_ACTIVE_MS : POLL_INTERVAL_IDLE_MS;
    const id = setInterval(() => load(), ms);
    return () => clearInterval(id);
  }, [load, session, pollExtraWork]);

  const refetchSession = useCallback(async () => {
    await load();
  }, [load]);

  return (
    <ExtraWorkContext.Provider value={{ session, popupOpen, setPopupOpen, refetchSession }}>
      {children}
    </ExtraWorkContext.Provider>
  );
}

export function useExtraWork() {
  const ctx = useContext(ExtraWorkContext);
  if (!ctx) {
    return { session: null, popupOpen: false, setPopupOpen: () => {}, refetchSession: async () => {} };
  }
  return ctx;
}
