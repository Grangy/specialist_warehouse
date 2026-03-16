'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useToastContext } from '@/contexts/ToastContext';

const EXTRA_WORK_SOUND_URL = '/music/you-will-work.wav';

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
  elapsedSecBeforeLunch: number;
  ratePerHour?: number;
  dayCoefficient?: number;
}

interface ExtraWorkContextType {
  session: ExtraWorkSession | null;
  popupOpen: boolean;
  setPopupOpen: (v: boolean) => void;
  refetchSession: () => Promise<void>;
}

const ExtraWorkContext = createContext<ExtraWorkContextType | undefined>(undefined);

export function ExtraWorkProvider({ children }: { children: React.ReactNode }) {
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

  useEffect(() => {
    queueMicrotask(() => load());
    const id = setInterval(() => load(), 5000);
    return () => clearInterval(id);
  }, [load]);

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
