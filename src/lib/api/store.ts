// Общее хранилище для API routes
// В реальном приложении это была бы БД

import { mockShipments } from './mockData';

// Хранилище заказов
export let shipments = JSON.parse(JSON.stringify(mockShipments));

// Хранилище блокировок заказов { shipmentId: { userId, lockedAt } }
export let shipmentLocks: Record<string, { userId: string; lockedAt: number }> = {};

// Время жизни блокировки (30 минут)
export const LOCK_TIMEOUT = 30 * 60 * 1000;

// Очистка устаревших блокировок
export function cleanupLocks() {
  const now = Date.now();
  Object.keys(shipmentLocks).forEach((id) => {
    if (now - shipmentLocks[id].lockedAt > LOCK_TIMEOUT) {
      delete shipmentLocks[id];
    }
  });
}

// Функция для сброса данных (для тестирования)
export function resetShipments() {
  shipments = JSON.parse(JSON.stringify(mockShipments));
  shipmentLocks = {};
}

