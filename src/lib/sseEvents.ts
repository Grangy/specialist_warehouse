/**
 * Управление Server-Sent Events для обновлений заказов в реальном времени
 */

type EventListener = (eventType: string, shipmentData: any) => void;

// Глобальное хранилище слушателей событий
declare global {
  var shipmentEventListeners: Set<EventListener> | undefined;
}

/**
 * Добавляет слушателя событий
 */
export function addShipmentEventListener(listener: EventListener) {
  if (typeof global === 'undefined') return;
  
  if (!global.shipmentEventListeners) {
    global.shipmentEventListeners = new Set();
  }
  
  global.shipmentEventListeners.add(listener);
}

/**
 * Удаляет слушателя событий
 */
export function removeShipmentEventListener(listener: EventListener) {
  if (typeof global === 'undefined' || !global.shipmentEventListeners) return;
  
  global.shipmentEventListeners.delete(listener);
}

/**
 * Отправляет событие всем подключенным клиентам
 */
export function emitShipmentEvent(eventType: string, shipmentData: any) {
  if (typeof global === 'undefined' || !global.shipmentEventListeners) {
    return;
  }

  global.shipmentEventListeners.forEach((listener) => {
    try {
      listener(eventType, shipmentData);
    } catch (error) {
      console.error('[SSE] Ошибка при отправке события через listener:', error);
    }
  });
}
