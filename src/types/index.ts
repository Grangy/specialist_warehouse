// Типы для заказов и товаров

export type ShipmentStatus = 'new' | 'pending_confirmation' | 'processed' | 'confirmed';

export interface ShipmentLine {
  sku: string;
  art?: string; // Дополнительный артикул от 1С (для отображения)
  name: string;
  qty: number;
  uom: string;
  location?: string;
  warehouse?: string;
  collected_qty?: number; // Количество собранное сборщиком
  checked?: boolean; // Флаг собранности (для сборки)
  confirmed_qty?: number; // Количество подтвержденное проверяльщиком
  confirmed?: boolean; // Флаг подтверждения (для проверки)
}

export interface ShipmentTask {
  id: string;
  warehouse?: string;
  status: string;
  collector_name?: string;
  created_at: string;
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
  collector_id?: string;
  collectors?: string[];
  checker_name?: string;
  checker_id?: string;
  checkers?: string[];
  dictator_name?: string;
  dictator_id?: string;
  dictators?: string[];
  started_at?: string;
  business_region?: string;
  locked?: boolean;
  lockedBy?: string | null;
  lockedByCurrentUser?: boolean;
  tasks_progress?: {
    confirmed: number;
    total: number;
  };
  confirmed_at?: string | null;
  task_id?: string; // ID задания (для режима подтверждения)
  tasks?: ShipmentTask[]; // Массив заданий для режима ожидания
  collector_visible?: boolean; // Виден ли заказ сборщику (для проверяльщиков и админов)
  places?: number | null; // Количество мест для задания
  crossed_out_qty?: number; // Количество вычеркнутых товаров (не собрали/откорректировали)
  crossed_out_items?: number; // Количество позиций с вычеркнутыми товарами
}

export type Tab = 'new' | 'processed' | 'waiting' | 'regions';

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

