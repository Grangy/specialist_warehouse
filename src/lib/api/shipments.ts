// API функции для работы с заказами

import { apiClient } from './client';
import type { Shipment, LockResponse } from '@/types';

const shipmentsListCache = new Map<string, { etag: string | null; data: Shipment[] }>();

export const shipmentsApi = {
  /**
   * Получить все заказы
   */
  async getAll(params?: { status?: string }): Promise<Shipment[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    
    const query = queryParams.toString();
    const cacheKey = `shipments${query ? `?${query}` : ''}`;
    const cached = shipmentsListCache.get(cacheKey) ?? null;

    // Для списка заказов используем ETag/304 (сервер поддерживает If-None-Match).
    // Это радикально снижает нагрузку при частых обновлениях списка.
    const res = await fetch(`/api/${cacheKey}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}),
        'Cache-Control': 'no-store',
      },
    });

    if (res.status === 304 && cached) {
      return cached.data;
    }
    if (!res.ok) {
      let message = `HTTP error! status: ${res.status}`;
      try {
        const t = await res.text();
        if (t) {
          try {
            const j = JSON.parse(t) as any;
            message = j?.message || j?.error || message;
          } catch {
            message = t;
          }
        }
      } catch {
        // ignore
      }
      throw { message, status: res.status } as any;
    }

    const data = (await res.json()) as Shipment[];
    const etag = res.headers.get('etag');
    shipmentsListCache.set(cacheKey, { etag, data });
    return data;
  },

  /**
   * Заблокировать заказ.
   * confirmTakeOver: true — подтверждение перехвата (после алерта «Вы точно уверены?»).
   */
  async lock(shipmentId: string, options?: { confirmTakeOver?: boolean }): Promise<LockResponse> {
    return apiClient.post<LockResponse>(`/shipments/${shipmentId}/lock`, options ?? {});
  },

  /**
   * Разблокировать заказ
   */
  async unlock(shipmentId: string): Promise<LockResponse> {
    return apiClient.post<LockResponse>(`/shipments/${shipmentId}/unlock`, {});
  },

  /**
   * Обновить heartbeat блокировки (показывает, что пользователь активен)
   */
  async heartbeat(shipmentId: string): Promise<{ success: boolean }> {
    return apiClient.post<{ success: boolean }>(`/shipments/${shipmentId}/heartbeat`, {});
  },

  /**
   * Сбросить сборщика для задания (только для админа)
   * Сохраняет прогресс, но снимает блокировку
   */
  async resetCollector(taskId: string): Promise<{ success: boolean; message: string; previousCollector: string | null }> {
    return apiClient.post<{ success: boolean; message: string; previousCollector: string | null }>(`/shipments/${taskId}/reset-collector`, {});
  },

  /**
   * Поднять / опустить заказ в приоритете (только для админа).
   * Поднятый заказ отображается выше приоритета регионов для всех в режиме сборки.
   */
  async pinOrder(shipmentId: string, pin: boolean): Promise<{ success: boolean; pinned: boolean; message: string }> {
    return apiClient.post<{ success: boolean; pinned: boolean; message: string }>(`/shipments/${shipmentId}/pin`, { pin });
  },

  /**
   * Отметить заказ как обработанный (сборка завершена)
   */
  async markPendingConfirmation(
    shipmentId: string,
    data: {
      lines: Array<{ id?: string; sku: string; collected_qty: number }>;
    }
  ): Promise<Shipment> {
    return apiClient.post<Shipment>(
      `/shipments/${shipmentId}/pending_confirmation`,
      data
    );
  },

  /**
   * Подтвердить заказ (проверка завершена)
   */
  async confirmShipment(
    shipmentId: string,
    data: {
      lines: Array<{ id?: string; sku: string; collected_qty: number; checked?: boolean }>;
      comment?: string;
      places?: number;
      customerName?: string;
    }
  ): Promise<Shipment & { 
    all_tasks_confirmed?: boolean; 
    tasks_progress?: { confirmed: number; total: number };
    final_order_data?: any;
    shipment_number?: string;
  }> {
    const response = await apiClient.post<Shipment & { 
      all_tasks_confirmed?: boolean; 
      tasks_progress?: { confirmed: number; total: number };
      final_order_data?: any;
      shipment_number?: string;
    }>(
      `/shipments/${shipmentId}/confirm`,
      data
    );
    
    if ((response as any)?.all_tasks_confirmed && (response as any)?.final_order_data) {
      const shipmentNumber = (response as any)?.shipment_number || 'N/A';
      const tasksCount = (response as any)?.tasks_progress?.total || 0;
      console.log('✅ Заказ отправлен в офис:', shipmentNumber, `(${tasksCount} заданий)`);
    }
    
    return response;
  },

  /**
   * Отметить заказ как обработанный (старый метод)
   */
  async markProcessed(
    shipmentId: string,
    data: {
      lines: Array<{ id?: string; sku: string; collected_qty: number; checked: boolean }>;
    }
  ): Promise<Shipment> {
    return apiClient.post<Shipment>(
      `/shipments/${shipmentId}/processed`,
      data
    );
  },

  /**
   * Сохранить прогресс проверки в БД (отдельно от прогресса сборки).
   * taskId может быть id задания или id заказа (shipmentId).
   */
  async saveConfirmationProgress(
    taskId: string,
    data: {
      lines: Array<{
        sku: string;
        confirmed_qty: number | null;
        confirmed?: boolean;
      }>;
    }
  ): Promise<{ success: boolean; progress: { confirmed: number; total: number } }> {
    return apiClient.post<{ success: boolean; progress: { confirmed: number; total: number } }>(
      `/shipments/${taskId}/save-confirmation-progress`,
      data
    );
  },

  /**
   * Сохранить прогресс сборки в БД
   */
  async saveProgress(
    shipmentId: string,
    data: {
      lines: Array<{ sku: string; collected_qty: number | null; checked?: boolean }>;
    }
  ): Promise<{ success: boolean; progress: { collected: number; total: number } }> {
    return apiClient.post<{ success: boolean; progress: { collected: number; total: number } }>(
      `/shipments/${shipmentId}/save-progress`,
      data
    );
  },
};
