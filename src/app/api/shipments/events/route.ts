import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authenticateRequest } from '@/lib/middleware';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/shipments/events
 * 
 * Server-Sent Events (SSE) endpoint для получения обновлений заказов в реальном времени
 * 
 * События:
 * - shipment:created - новый заказ создан
 * - shipment:updated - заказ обновлен
 * - shipment:status_changed - статус заказа изменился
 */
export async function GET(request: NextRequest) {
  // Проверяем авторизацию
  const authResult = await authenticateRequest(request);
  if (authResult instanceof Response) {
    return authResult;
  }

  // Создаем поток SSE
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      
      // Отправляем начальное сообщение о подключении
      const sendEvent = (event: string, data: any) => {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      sendEvent('connected', { message: 'Connected to shipments events stream' });

      // Функция для отправки события обновления
      const broadcastUpdate = async (eventType: string, shipmentData: any) => {
        try {
          sendEvent(eventType, shipmentData);
        } catch (error) {
          console.error('[SSE] Ошибка при отправке события:', error);
        }
      };

      // Сохраняем функцию для использования в других местах
      // В production можно использовать Redis pub/sub или другую систему сообщений
      if (typeof global !== 'undefined') {
        if (!global.shipmentEventListeners) {
          global.shipmentEventListeners = new Set();
        }
        global.shipmentEventListeners.add(broadcastUpdate);
      }

      // Отправляем heartbeat каждые 30 секунд для поддержания соединения
      const heartbeatInterval = setInterval(() => {
        try {
          sendEvent('heartbeat', { timestamp: Date.now() });
        } catch (error) {
          console.error('[SSE] Ошибка при отправке heartbeat:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30000);

      // Очистка при закрытии соединения
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatInterval);
        if (typeof global !== 'undefined' && global.shipmentEventListeners) {
          global.shipmentEventListeners.delete(broadcastUpdate);
        }
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Отключаем буферизацию в nginx
    },
  });
}

// Глобальная функция для отправки событий из других API routes
export function emitShipmentEvent(eventType: string, shipmentData: any) {
  if (typeof global !== 'undefined' && global.shipmentEventListeners) {
    global.shipmentEventListeners.forEach((listener: Function) => {
      try {
        listener(eventType, shipmentData);
      } catch (error) {
        console.error('[SSE] Ошибка при отправке события через listener:', error);
      }
    });
  }
}

// Расширяем глобальный тип для TypeScript
declare global {
  var shipmentEventListeners: Set<Function> | undefined;
}
