'use client';

import React, { createContext, useCallback, useRef, useState, useMemo, useEffect } from 'react';

const POLL_URL = '/api/shipments/poll';

/** Базовый интервал опроса (мс) — прогресс сборки/проверки у других пользователей */
const POLL_INTERVAL_MS = 10_000;
/** Максимальный интервал при backoff (мс) */
const POLL_INTERVAL_MAX_MS = 120_000;
/** После скольких ответов "нет изменений" подряд увеличивать интервал */
const BACKOFF_AFTER_NO_UPDATES = 5;

export interface PendingMessagePayload {
  id: string;
  text: string;
  fromName: string;
  sentAt: string;
  /** URL звука (например /music/wc3.mp3 для СОС) */
  soundUrl?: string;
}

export interface LastPollResult {
  hasUpdates: boolean;
  pendingMessage?: PendingMessagePayload;
}

type OnHasUpdates = () => void;

interface ShipmentsPollingContextValue {
  subscribe: (callback: OnHasUpdates) => () => void;
  refetchDone: () => void;
  triggerRefetch: () => void;
  isPolling: boolean;
  /** Последний ответ poll (hasUpdates + pendingMessage от админа) */
  lastPollResult: LastPollResult | null;
  /** Очистить отображаемое сообщение после закрытия попапа (вызов после dismiss API) */
  clearPendingMessage: () => void;
}

const ShipmentsPollingContext = createContext<ShipmentsPollingContextValue | null>(null);

export function ShipmentsPollingProvider({ children }: { children: React.ReactNode }) {
  const subscribersRef = useRef<Set<OnHasUpdates>>(new Set());
  const lastFetchTimeRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const noUpdatesCountRef = useRef(0);
  const currentIntervalMsRef = useRef(POLL_INTERVAL_MS);
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollResult, setLastPollResult] = useState<LastPollResult | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const startPolling = useCallback(() => {
    if (subscribersRef.current.size === 0) return;
    stopPolling();
    const ms = currentIntervalMsRef.current;
    intervalRef.current = setInterval(() => {
      pollRef.current?.();
    }, ms);
    setIsPolling(true);
  }, [stopPolling]);

  const pollRef = useRef<() => Promise<void>>(async () => {});
  const poll = useCallback(async () => {
    if (subscribersRef.current.size === 0) return;

    const since = lastFetchTimeRef.current;
    const url = since ? `${POLL_URL}?since=${encodeURIComponent(since)}` : POLL_URL;

    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setLastPollResult({
        hasUpdates: Boolean(data.hasUpdates),
        pendingMessage: data.pendingMessage ?? undefined,
      });
      if (data.hasUpdates) {
        noUpdatesCountRef.current = 0;
        currentIntervalMsRef.current = POLL_INTERVAL_MS;
        subscribersRef.current.forEach((cb) => {
          try {
            cb();
          } catch (e) {
            console.error('[Polling] subscriber error:', e);
          }
        });
      } else {
        noUpdatesCountRef.current += 1;
        if (noUpdatesCountRef.current >= BACKOFF_AFTER_NO_UPDATES) {
          noUpdatesCountRef.current = 0;
          currentIntervalMsRef.current = Math.min(
            currentIntervalMsRef.current * 2,
            POLL_INTERVAL_MAX_MS
          );
          stopPolling();
          startPolling();
        }
      }
    } catch {
      // Сеть/ошибка — не меняем интервал, следующий тик по расписанию
    }
  }, [stopPolling, startPolling]);
  // Держим актуальную ссылку на poll для setInterval (избегаем циклических deps)
  // eslint-disable-next-line react-hooks/immutability -- ref обновляется синхронно для корректного первого тика
  pollRef.current = poll;

  const subscribe = useCallback((callback: OnHasUpdates) => {
    subscribersRef.current.add(callback);
    if (subscribersRef.current.size === 1) {
      currentIntervalMsRef.current = POLL_INTERVAL_MS;
      startPolling();
    }
    return () => {
      subscribersRef.current.delete(callback);
      if (subscribersRef.current.size === 0) {
        stopPolling();
      }
    };
  }, [startPolling, stopPolling]);

  const refetchDone = useCallback(() => {
    lastFetchTimeRef.current = new Date().toISOString();
  }, []);

  const triggerRefetch = useCallback(() => {
    if (subscribersRef.current.size === 0) return;
    noUpdatesCountRef.current = 0;
    currentIntervalMsRef.current = POLL_INTERVAL_MS;
    subscribersRef.current.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error('[Polling] triggerRefetch subscriber error:', e);
      }
    });
  }, []);

  const clearPendingMessage = useCallback(() => {
    setLastPollResult((prev) =>
      prev ? { ...prev, pendingMessage: undefined } : null
    );
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        stopPolling();
      } else {
        if (subscribersRef.current.size > 0) {
          poll();
          startPolling();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopPolling();
    };
  }, [poll, startPolling, stopPolling]);

  const value = useMemo<ShipmentsPollingContextValue>(
    () => ({
      subscribe,
      refetchDone,
      triggerRefetch,
      isPolling,
      lastPollResult,
      clearPendingMessage,
    }),
    [subscribe, refetchDone, triggerRefetch, isPolling, lastPollResult, clearPendingMessage]
  );

  return (
    <ShipmentsPollingContext.Provider value={value}>
      {children}
    </ShipmentsPollingContext.Provider>
  );
}

export function useShipmentsPolling() {
  return React.useContext(ShipmentsPollingContext);
}
