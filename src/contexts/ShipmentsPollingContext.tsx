'use client';

import React, { createContext, useCallback, useRef, useState, useMemo, useEffect } from 'react';

const POLL_URL = '/api/shipments/poll';

/** Базовый интервал опроса (мс) — прогресс сборки/проверки у других пользователей */
const POLL_INTERVAL_MS = 3_000;
/** Максимальный интервал при backoff (мс) */
const POLL_INTERVAL_MAX_MS = 7_000;
/** После скольких ответов "нет изменений" подряд увеличивать интервал */
const BACKOFF_AFTER_NO_UPDATES = 8;
/** Слияние вызовов подписчиков при hasUpdates (меньше дублей GET /api/shipments) */
const NOTIFY_DEBOUNCE_MS = 400;

export interface PendingMessagePayload {
  id: string;
  text: string;
  fromName: string;
  sentAt: string;
  /** URL звука (например /music/wc3.mp3 для СОС) */
  soundUrl?: string;
  /** sos = подзыв сборщика во время проверки (СОС) */
  type?: 'sos' | 'admin';
  action?: {
    kind: 'extra_work_request';
    requestId: string;
  };
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
  /** Не запускать второй poll, пока предыдущий не завершился (убирает дубли в nginx) */
  const pollInFlightRef = useRef(false);
  const lastEtagRef = useRef<string | null>(null);
  const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [lastPollResult, setLastPollResult] = useState<LastPollResult | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (notifyTimerRef.current) {
      clearTimeout(notifyTimerRef.current);
      notifyTimerRef.current = null;
    }
    setIsPolling(false);
  }, []);

  const flushNotifySubscribers = useCallback(() => {
    notifyTimerRef.current = null;
    subscribersRef.current.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error('[Polling] subscriber error:', e);
      }
    });
  }, []);

  const scheduleNotifySubscribers = useCallback(() => {
    if (notifyTimerRef.current) clearTimeout(notifyTimerRef.current);
    notifyTimerRef.current = setTimeout(flushNotifySubscribers, NOTIFY_DEBOUNCE_MS);
  }, [flushNotifySubscribers]);

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
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;

    const since = lastFetchTimeRef.current;
    const url = since ? `${POLL_URL}?since=${encodeURIComponent(since)}` : POLL_URL;

    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: lastEtagRef.current ? { 'If-None-Match': lastEtagRef.current } : undefined,
      });
      if (res.status === 304) {
        // Ничего не поменялось (ETag). Считаем как "no updates".
        noUpdatesCountRef.current += 1;
        if (noUpdatesCountRef.current >= BACKOFF_AFTER_NO_UPDATES) {
          noUpdatesCountRef.current = 0;
          currentIntervalMsRef.current = Math.min(currentIntervalMsRef.current * 2, POLL_INTERVAL_MAX_MS);
          stopPolling();
          startPolling();
        }
        return;
      }
      if (!res.ok) return;

      const etag = res.headers.get('etag');
      if (etag) lastEtagRef.current = etag;
      const data = await res.json();
      setLastPollResult({
        hasUpdates: Boolean(data.hasUpdates),
        pendingMessage: data.pendingMessage ?? undefined,
      });
      if (data.hasUpdates) {
        noUpdatesCountRef.current = 0;
        currentIntervalMsRef.current = POLL_INTERVAL_MS;
        scheduleNotifySubscribers();
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
    } finally {
      pollInFlightRef.current = false;
    }
  }, [stopPolling, startPolling, scheduleNotifySubscribers]);
  // Держим актуальную ссылку на poll для setInterval (избегаем циклических deps)
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
    scheduleNotifySubscribers();
  }, [scheduleNotifySubscribers]);

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
