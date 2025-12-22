// API функции для работы с заказами

import { apiClient } from './client';
import type { Shipment, LockResponse } from '@/types';

export const shipmentsApi = {
  /**
   * Получить все заказы
   */
  async getAll(params?: { status?: string }): Promise<Shipment[]> {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    
    const query = queryParams.toString();
    // Используем относительный путь, так как baseURL уже содержит /api
    return apiClient.get<Shipment[]>(`/shipments${query ? `?${query}` : ''}`);
  },

  /**
   * Заблокировать заказ
   */
  async lock(shipmentId: string): Promise<LockResponse> {
    return apiClient.post<LockResponse>(`/shipments/${shipmentId}/lock`, {});
  },

  /**
   * Разблокировать заказ
   */
  async unlock(shipmentId: string): Promise<LockResponse> {
    return apiClient.post<LockResponse>(`/shipments/${shipmentId}/unlock`, {});
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
   * Сохранить прогресс проверки в БД (отдельно от прогресса сборки)
   */
  async saveConfirmationProgress(
    taskId: string,
    data: {
      lines: Array<{ sku: string; confirmed_qty: number | null }>;
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
