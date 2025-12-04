'use client';

import { useState, useCallback } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ConfirmChecklistState } from '@/types';
import { useToast } from './useToast';

export function useConfirm() {
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(null);
  const [checklistState, setChecklistState] = useState<Record<number, ConfirmChecklistState>>({});
  const [editState, setEditState] = useState<Record<number, boolean>>({});
  const { showToast, showError, showSuccess } = useToast();

  const openModal = useCallback((shipment: Shipment) => {
    setCurrentShipment(shipment);

    // Инициализируем состояние чеклиста
    const initialState: Record<number, ConfirmChecklistState> = {};
    if (shipment.lines && shipment.lines.length > 0) {
      shipment.lines.forEach((line, index) => {
        initialState[index] = {
          qty: line.qty,
          collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
          confirmed: false,
        };
      });
    }
    setChecklistState(initialState);
    setEditState({});
  }, []);

  const closeModal = useCallback(() => {
    setCurrentShipment(null);
    setChecklistState({});
    setEditState({});
  }, []);

  const updateCollectedQty = useCallback((lineIndex: number, qty: number) => {
    if (!currentShipment) return;
    
    const line = currentShipment.lines[lineIndex];
    const maxQty = line.qty;
    const newQty = Math.min(Math.max(0, Math.floor(qty)), maxQty);

    setChecklistState((prev) => {
      const newState = { ...prev };
      const wasConfirmed = newState[lineIndex]?.confirmed;
      
      if (!newState[lineIndex]) {
        newState[lineIndex] = {
          qty: line.qty,
          collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
          confirmed: false,
        };
      }
      
      newState[lineIndex].collectedQty = newQty;
      if (wasConfirmed) {
        newState[lineIndex].confirmed = true;
      }
      
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
    if (!currentShipment) return;
    
    const wasConfirmed = checklistState[lineIndex]?.confirmed;
    
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (currentShipment.lines[lineIndex]) {
        currentShipment.lines[lineIndex].collected_qty = newState[lineIndex]?.collectedQty ?? lineIndex;
      }
      if (newState[lineIndex]) {
        newState[lineIndex].confirmed = wasConfirmed || false;
      }
      return newState;
    });
    
    setEditState((prev) => {
      const newState = { ...prev };
      delete newState[lineIndex];
      return newState;
    });
  }, [currentShipment, checklistState]);

  const cancelEditQty = useCallback((lineIndex: number) => {
    if (!currentShipment) return;
    
    const line = currentShipment.lines[lineIndex];
    const wasConfirmed = checklistState[lineIndex]?.confirmed;
    
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (newState[lineIndex] && newState[lineIndex].originalQty !== undefined) {
        newState[lineIndex].collectedQty = newState[lineIndex].originalQty;
      } else {
        newState[lineIndex] = {
          qty: line.qty,
          collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
          confirmed: wasConfirmed || false,
        };
      }
      return newState;
    });
    
    setEditState((prev) => {
      const newState = { ...prev };
      delete newState[lineIndex];
      return newState;
    });
  }, [currentShipment, checklistState]);

  const confirmItem = useCallback((lineIndex: number) => {
    setChecklistState((prev) => {
      const newState = { ...prev };
      if (!newState[lineIndex]) {
        const line = currentShipment?.lines[lineIndex];
        if (line) {
          newState[lineIndex] = {
            qty: line.qty,
            collectedQty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
            confirmed: false,
          };
        }
      }
      if (newState[lineIndex]) {
        newState[lineIndex].confirmed = true;
      }
      return newState;
    });
  }, [currentShipment]);

  const confirmShipment = useCallback(async () => {
    if (!currentShipment) {
      console.error('[useConfirm] Ошибка: нет данных о заказе');
      showError('Ошибка: нет данных о заказе');
      return { completed: false };
    }

    const total = currentShipment.lines.length;
    const confirmedCount = currentShipment.lines.filter(
      (_, index) => checklistState[index]?.confirmed
    ).length;

    if (confirmedCount !== total) {
      showError('Необходимо подтвердить все товары перед подтверждением заказа');
      return { completed: false };
    }

    try {
      const linesData = currentShipment.lines.map((line, index) => ({
        sku: line.sku,
        collected_qty: checklistState[index]?.collectedQty ?? (line.collected_qty !== undefined ? line.collected_qty : line.qty),
        checked: true,
      }));

      const response = await shipmentsApi.confirmShipment(currentShipment.id, {
        lines: linesData,
      });

      const allTasksConfirmed = (response as any)?.all_tasks_confirmed === true;
      const finalOrderData = (response as any)?.final_order_data;
      
      if (allTasksConfirmed && finalOrderData) {
        const shipmentNumber = (response as any)?.shipment_number || currentShipment.shipment_number || currentShipment.number || 'N/A';
        const tasksCount = (response as any)?.tasks_progress?.total || 0;
        
        console.log('✅ Заказ отправлен в офис:', shipmentNumber, `(${tasksCount} заданий)`);
        showSuccess(`✅ Все задания подтверждены! Заказ ${shipmentNumber} отправлен в офис.`);
        
        const result = {
          completed: true,
          orderData: {
            number: shipmentNumber,
            tasksCount: tasksCount,
            finalData: finalOrderData,
          },
        };
        
        return result;
      } else {
        const confirmed = (response as any)?.tasks_progress?.confirmed || 0;
        const total = (response as any)?.tasks_progress?.total || 0;
        showSuccess(`Задание подтверждено (${confirmed}/${total} заданий)`);
        await closeModal();
        return { completed: false };
      }
    } catch (error: any) {
      console.error('[useConfirm] Ошибка подтверждения заказа:', error);
      showError('Не удалось подтвердить заказ: ' + (error?.message || 'Неизвестная ошибка'));
      throw error;
    }
  }, [currentShipment, checklistState, closeModal, showSuccess, showError]);

  const getProgress = useCallback(() => {
    if (!currentShipment || !currentShipment.lines) {
      return { confirmed: 0, total: 0 };
    }

    const total = currentShipment.lines.length;
    const confirmed = currentShipment.lines.filter(
      (_, index) => checklistState[index]?.confirmed
    ).length;

    return { confirmed, total };
  }, [currentShipment, checklistState]);

  const isReady = useCallback(() => {
    const progress = getProgress();
    return progress.confirmed === progress.total && progress.total > 0;
  }, [getProgress]);

  const getWarnings = useCallback(() => {
    if (!currentShipment || !currentShipment.lines) {
      return { hasShortages: false, hasZeroItems: false, shortages: [], zeroItems: [] };
    }

    const shortages: Array<{ name: string; shortage: number }> = [];
    const zeroItems: Array<{ name: string }> = [];

    currentShipment.lines.forEach((line, index) => {
      const state = checklistState[index];
      const collectedQty = state?.collectedQty ?? (line.collected_qty !== undefined ? line.collected_qty : line.qty);
      
      if (collectedQty === 0) {
        zeroItems.push({ name: line.name });
      } else if (collectedQty < line.qty) {
        shortages.push({ name: line.name, shortage: line.qty - collectedQty });
      }
    });

    return {
      hasShortages: shortages.length > 0,
      hasZeroItems: zeroItems.length > 0,
      shortages,
      zeroItems,
    };
  }, [currentShipment, checklistState]);

  const confirmAll = useCallback(async (shipment: Shipment) => {
    try {
      const linesData = shipment.lines.map((line) => ({
        sku: line.sku,
        collected_qty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
        checked: true,
      }));

      const response = await shipmentsApi.confirmShipment(shipment.id, {
        lines: linesData,
      });

      const allTasksConfirmed = (response as any)?.all_tasks_confirmed === true;
      const finalOrderData = (response as any)?.final_order_data;
      
      if (allTasksConfirmed && finalOrderData) {
        const shipmentNumber = (response as any)?.shipment_number || shipment.shipment_number || shipment.number || 'N/A';
        const tasksCount = (response as any)?.tasks_progress?.total || 0;
        
        console.log('✅ Заказ отправлен в офис:', shipmentNumber, `(${tasksCount} заданий)`);
        
        const result = {
          completed: true,
          orderData: {
            number: shipmentNumber,
            tasksCount: tasksCount,
            finalData: finalOrderData,
          },
        };
        
        return result;
      } else {
        const confirmed = (response as any)?.tasks_progress?.confirmed || 0;
        const total = (response as any)?.tasks_progress?.total || 0;
        showSuccess(`Все позиции подтверждены (${confirmed}/${total} заданий)`);
        return { completed: false, response };
      }
    } catch (error: any) {
      console.error('[useConfirm] Ошибка при подтверждении всех позиций:', error);
      showError(error.message || 'Не удалось подтвердить все позиции');
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
    updateCollectedQty,
    startEditQty,
    confirmEditQty,
    cancelEditQty,
    confirmItem,
    confirmShipment,
    confirmAll,
    getProgress,
    isReady,
    getWarnings,
  };
}

