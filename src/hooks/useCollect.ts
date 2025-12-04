'use client';

import { useState, useCallback, useRef } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ShipmentLine, CollectChecklistState } from '@/types';
import { useToast } from './useToast';

export function useCollect() {
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(null);
  const [checklistState, setChecklistState] = useState<Record<number, CollectChecklistState>>({});
  const [editState, setEditState] = useState<Record<number, boolean>>({});
  const [lockedShipmentId, setLockedShipmentId] = useState<string | null>(null);
  const { showToast, showError, showSuccess } = useToast();

  const openModal = useCallback(async (shipment: Shipment) => {
    // Предотвращаем множественные открытия
    if (currentShipment !== null) {
      console.log('Модальное окно уже открыто, игнорируем повторное открытие');
      return;
    }

    try {
      console.log('Открытие модального окна для заказа:', shipment.id);
      
      // Блокируем заказ
      const lockResponse = await shipmentsApi.lock(shipment.id);
      console.log('Ответ блокировки:', lockResponse);
      
      if (!lockResponse || !lockResponse.success) {
        const message = lockResponse?.message || 'Заказ уже заблокирован другим пользователем';
        showError(message);
        return;
      }

      console.log('Блокировка успешна, открываем модальное окно');
      
      // Инициализируем состояние чеклиста ПЕРЕД установкой currentShipment
      const initialState: Record<number, CollectChecklistState> = {};
      if (shipment.lines && shipment.lines.length > 0) {
        shipment.lines.forEach((line, index) => {
          initialState[index] = {
            collected: false,
            qty: line.qty,
            collectedQty: line.qty,
          };
        });
      }
      
      // Устанавливаем состояние синхронно в правильном порядке
      setChecklistState(initialState);
      setEditState({});
      setLockedShipmentId(shipment.id);
      // Устанавливаем currentShipment последним, чтобы isOpen стал true
      setCurrentShipment(shipment);
      
      console.log('Состояние модального окна установлено, currentShipment:', shipment.id);
    } catch (error: any) {
      console.error('Ошибка блокировки заказа:', error);
      const errorMessage = error?.message || 'Не удалось заблокировать заказ';
      showError(errorMessage);
    }
  }, [currentShipment, showError]);

  const closeModal = useCallback(async () => {
    if (lockedShipmentId) {
      try {
        await shipmentsApi.unlock(lockedShipmentId);
        setLockedShipmentId(null);
      } catch (error) {
        console.error('Ошибка разблокировки:', error);
      }
    }
    setCurrentShipment(null);
    setChecklistState({});
    setEditState({});
  }, [lockedShipmentId]);

  const updateCollected = useCallback((lineIndex: number, collected: boolean) => {
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (!newState[lineIndex]) {
        const line = currentShipment?.lines[lineIndex];
        if (line) {
          newState[lineIndex] = {
            collected: false,
            qty: line.qty,
            collectedQty: line.qty,
          };
        }
      }
      if (newState[lineIndex]) {
        newState[lineIndex].collected = collected;
      }
      return newState;
    });
  }, [currentShipment]);

  const updateCollectedQty = useCallback((lineIndex: number, qty: number) => {
    if (!currentShipment) return;
    
    const line = currentShipment.lines[lineIndex];
    const maxQty = line.qty;
    const newQty = Math.min(Math.max(0, Math.floor(qty)), maxQty);

    setChecklistState((prev) => {
      const newState = { ...prev };
      if (!newState[lineIndex]) {
        newState[lineIndex] = {
          collected: false,
          qty: line.qty,
          collectedQty: line.qty,
        };
      }
      newState[lineIndex].collectedQty = newQty;
      return newState;
    });
  }, [currentShipment]);

  const startEditQty = useCallback((lineIndex: number) => {
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (newState[lineIndex]) {
        newState[lineIndex].originalQty = newState[lineIndex].collectedQty;
      }
      return newState;
    });
    setEditState((prev) => ({ ...prev, [lineIndex]: true }));
  }, []);

  const confirmEditQty = useCallback((lineIndex: number) => {
    setEditState((prev) => {
      const newState = { ...prev };
      delete newState[lineIndex];
      return newState;
    });
  }, []);

  const cancelEditQty = useCallback((lineIndex: number) => {
    if (!currentShipment) return;
    
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (newState[lineIndex] && newState[lineIndex].originalQty !== undefined) {
        newState[lineIndex].collectedQty = newState[lineIndex].originalQty;
      } else {
        const line = currentShipment.lines[lineIndex];
        if (newState[lineIndex]) {
          newState[lineIndex].collectedQty = line.qty;
        }
      }
      return newState;
    });
    
    setEditState((prev) => {
      const newState = { ...prev };
      delete newState[lineIndex];
      return newState;
    });
  }, [currentShipment]);

  const confirmProcessing = useCallback(async () => {
    if (!currentShipment) {
      console.error('confirmProcessing вызван без currentShipment');
      return;
    }

    const shipmentId = currentShipment.id;
    console.log('Начинаем подтверждение обработки для заказа:', shipmentId);

    try {
      const linesData = currentShipment.lines.map((line, index) => ({
        sku: line.sku,
        collected_qty: checklistState[index]?.collectedQty ?? line.qty,
      }));

      console.log('Отправляем данные на сервер:', { shipmentId, linesData });

      const response = await shipmentsApi.markPendingConfirmation(shipmentId, {
        lines: linesData,
      });

      console.log('Заказ успешно отправлен на подтверждение:', response);
      showSuccess('Заказ успешно отправлен на подтверждение');
      
      // Закрываем модальное окно перед возвратом
      await closeModal();
      
      return response;
    } catch (error) {
      console.error('Ошибка подтверждения обработки:', error);
      showError('Не удалось подтвердить обработку заказа');
      throw error;
    }
  }, [currentShipment, checklistState, closeModal, showSuccess, showError]);

  const getProgress = useCallback(() => {
    if (!currentShipment || !currentShipment.lines) {
      return { collected: 0, total: 0, hasShortage: false };
    }

    const total = currentShipment.lines.length;
    let collected = 0;
    let hasShortage = false;

    currentShipment.lines.forEach((_, index) => {
      if (checklistState[index]?.collected) {
        collected++;
      }
      if (checklistState[index]?.collectedQty < checklistState[index]?.qty) {
        hasShortage = true;
      }
    });

    return { collected, total, hasShortage };
  }, [currentShipment, checklistState]);

  const isReady = useCallback(() => {
    const progress = getProgress();
    return progress.collected === progress.total && progress.total > 0;
  }, [getProgress]);

  const collectAll = useCallback(async (shipment: Shipment) => {
    try {
      // Блокируем задание
      const lockResponse = await shipmentsApi.lock(shipment.id);
      if (!lockResponse || !lockResponse.success) {
        showError(lockResponse?.message || 'Задание уже заблокировано другим пользователем');
        return;
      }

      // Собираем все позиции с полным количеством
      const linesData = shipment.lines.map((line) => ({
        sku: line.sku,
        collected_qty: line.qty, // Собираем все требуемое количество
      }));

      // Сразу переводим в pending_confirmation
      const response = await shipmentsApi.markPendingConfirmation(shipment.id, {
        lines: linesData,
      });

      showSuccess('Все позиции собраны и задание переведено в подтверждение');
      return response;
    } catch (error: any) {
      console.error('Ошибка при автоматической сборке всех позиций:', error);
      showError(error.message || 'Не удалось собрать все позиции');
      throw error;
    }
  }, [showError, showSuccess]);

  return {
    currentShipment,
    checklistState,
    editState,
    isOpen: currentShipment !== null,
    openModal,
    closeModal,
    updateCollected,
    updateCollectedQty,
    startEditQty,
    confirmEditQty,
    cancelEditQty,
    confirmProcessing,
    collectAll,
    getProgress,
    isReady,
  };
}

