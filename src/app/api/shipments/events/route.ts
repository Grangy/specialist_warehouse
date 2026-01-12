import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/middleware';
import { addShipmentEventListener, removeShipmentEventListener } from '@/lib/sseEvents';

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
  // Проверяем авторизацию (SSE запросы не имеют body, используем пустой объект)
  const authResult = await authenticateRequest(request, {});
  if (authResult instanceof NextResponse) {
    return authResult as Response;
  }
  
  // Если авторизация успешна, продолжаем создание SSE потока

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
      const broadcastUpdate = (eventType: string, shipmentData: any) => {
        try {
          sendEvent(eventType, shipmentData);
        } catch (error) {
          console.error('[SSE] Ошибка при отправке события:', error);
        }
      };

      // Добавляем слушателя
      addShipmentEventListener(broadcastUpdate);

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
        removeShipmentEventListener(broadcastUpdate);
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
