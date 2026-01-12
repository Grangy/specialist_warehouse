'use client';

import { useEffect, useRef, useCallback } from 'react';

type EventType = 'shipment:created' | 'shipment:updated' | 'shipment:status_changed' | 'heartbeat' | 'connected';

interface SSEOptions {
  onEvent?: (eventType: EventType, data: any) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useSSE(options: SSEOptions = {}) {
  const {
    onEvent,
    onError,
    onOpen,
    onClose,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isConnectingRef = useRef(false);

  const connect = useCallback(() => {
    // Предотвращаем множественные подключения
    if (isConnectingRef.current || eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    // Закрываем предыдущее соединение, если оно есть
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    isConnectingRef.current = true;

    try {
      const eventSource = new EventSource('/api/shipments/events');
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        console.log('[SSE] Подключение установлено');
        isConnectingRef.current = false;
        reconnectAttemptsRef.current = 0;
        onOpen?.();
      };

      eventSource.onerror = (error) => {
        console.error('[SSE] Ошибка подключения:', error);
        isConnectingRef.current = false;
        onError?.(error);

        // Закрываем соединение
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }

        // Пытаемся переподключиться
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[SSE] Попытка переподключения ${reconnectAttemptsRef.current}/${maxReconnectAttempts}...`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        } else {
          console.error('[SSE] Достигнуто максимальное количество попыток переподключения');
        }
      };

      // Обработка событий
      eventSource.addEventListener('connected', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        onEvent?.('connected', data);
      });

      eventSource.addEventListener('shipment:created', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Новый заказ создан:', data);
        onEvent?.('shipment:created', data);
      });

      eventSource.addEventListener('shipment:updated', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Заказ обновлен:', data);
        onEvent?.('shipment:updated', data);
      });

      eventSource.addEventListener('shipment:status_changed', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        console.log('[SSE] Статус заказа изменился:', data);
        onEvent?.('shipment:status_changed', data);
      });

      eventSource.addEventListener('heartbeat', (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        // Heartbeat для поддержания соединения, можно игнорировать
        onEvent?.('heartbeat', data);
      });
    } catch (error) {
      console.error('[SSE] Ошибка при создании EventSource:', error);
      isConnectingRef.current = false;
      onError?.(error as Event);
    }
  }, [onEvent, onError, onOpen, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    isConnectingRef.current = false;
    reconnectAttemptsRef.current = 0;
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    connect,
    disconnect,
    isConnected: eventSourceRef.current?.readyState === EventSource.OPEN,
  };
}
