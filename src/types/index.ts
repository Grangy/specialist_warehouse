// Типы для заказов и товаров

export type ShipmentStatus = 'new' | 'pending_confirmation' | 'processed' | 'confirmed';

export interface ShipmentLine {
  sku: string;
  name: string;
  qty: number;
  uom: string;
  location?: string;
  warehouse?: string;
  collected_qty?: number;
  checked?: boolean;
}

export interface Shipment {
  id: string;
  shipment_id?: string; // ID основного заказа (для заданий)
  shipment_number?: string; // Номер основного заказа (для заданий)
  number?: string; // Номер заказа (для обратной совместимости)
  warehouse?: string; // Склад (для заданий)
  created_at: string;
  customer_name: string;
  destination: string;
  items_count: number;
  total_qty: number;
  weight?: number | null;
  comment: string;
  status: ShipmentStatus;
  lines: ShipmentLine[];
  collector_name?: string;
  business_region?: string;
  locked?: boolean;
  lockedBy?: string | null;
  tasks_progress?: {
    confirmed: number;
    total: number;
  };
}

export type Tab = 'new' | 'processed';

// Состояние для сборки
export interface CollectChecklistState {
  collected: boolean;
  qty: number;
  collectedQty: number;
  originalQty?: number;
}

// Состояние для подтверждения
export interface ConfirmChecklistState {
  qty: number;
  collectedQty: number;
  confirmed: boolean;
  originalQty?: number;
}

// Состояние фильтров
export interface FilterState {
  search: string;
  warehouse: string;
  urgentOnly: boolean;
}

// Toast уведомления
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

// API ошибки
export interface APIError {
  message: string;
  status?: number;
}

// Lock response
export interface LockResponse {
  success: boolean;
  message?: string;
}

// Swipe состояние
export interface SwipeState {
  isDragging: boolean;
  hasConfirmed: boolean;
  startX: number;
  currentX: number;
}

