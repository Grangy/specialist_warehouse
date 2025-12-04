// Константы приложения

// Автоматически определяем базовый URL для работы с локальным IP
function getApiBase(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api`;
  }
  return process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000/api';
}

export const API_BASE = getApiBase();

export const API_ENDPOINTS = {
  shipments: `${API_BASE}/shipments`,
  markProcessed: (id: string) => `${API_BASE}/shipments/${id}/processed`,
  markPendingConfirmation: (id: string) => `${API_BASE}/shipments/${id}/pending_confirmation`,
  confirmShipment: (id: string) => `${API_BASE}/shipments/${id}/confirm`,
  lock: (id: string) => `${API_BASE}/shipments/${id}/lock`,
  unlock: (id: string) => `${API_BASE}/shipments/${id}/unlock`,
};

// Генерация уникального ID пользователя
export function getUserId(): string {
  if (typeof window === 'undefined') {
    return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  // Сохраняем в localStorage для сохранения между перезагрузками
  let userId = localStorage.getItem('userId');
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('userId', userId);
  }
  return userId;
}

// Время жизни блокировки (30 минут)
export const LOCK_TIMEOUT = 30 * 60 * 1000;

// Порог для swipe подтверждения (75%)
export const SWIPE_THRESHOLD = 0.75;

// Минимальная ширина слайдера в пикселях
export const SWIPE_MIN_WIDTH = 50;
