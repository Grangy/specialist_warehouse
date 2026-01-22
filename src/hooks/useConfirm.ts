'use client';

import { useState, useCallback } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ConfirmChecklistState } from '@/types';
import { useToast } from './useToast';

interface UseConfirmOptions {
  onClose?: () => void | Promise<void>;
}

export function useConfirm(options?: UseConfirmOptions) {
  const { onClose } = options || {};
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(null);
  const [checklistState, setChecklistState] = useState<Record<number, ConfirmChecklistState>>({});
  const [editState, setEditState] = useState<Record<number, boolean>>({});
  const [removingItems, setRemovingItems] = useState<Set<number>>(new Set());
  const [changedLocations, setChangedLocations] = useState<Record<number, string>>({}); // Отслеживаем измененные места
  const { showToast, showError, showSuccess } = useToast();

  const openModal = useCallback((shipment: Shipment) => {
    // Очищаем список измененных мест при открытии нового модального окна
    setChangedLocations({});
    
    // Логируем данные заказа для отладки, ВКЛЮЧАЯ location
    console.log('🔵 [useConfirm.openModal] Данные заказа для инициализации:', {
      id: shipment.id,
      number: shipment.number || shipment.shipment_number,
      linesCount: shipment.lines?.length || 0,
      lines: shipment.lines?.map((line: any, idx: number) => ({
        index: idx,
        sku: line.sku,
        qty: line.qty,
        location: line.location || 'null',
        collected_qty: line.collected_qty,
        confirmed_qty: line.confirmed_qty,
        confirmed: line.confirmed,
      })) || []
    });
    
    setCurrentShipment(shipment);

    // Инициализируем состояние чеклиста
    // Загружаем сохраненный прогресс ПРОВЕРКИ из БД (отдельно от прогресса сборки)
    const initialState: Record<number, ConfirmChecklistState> = {};
    if (shipment.lines && shipment.lines.length > 0) {
      shipment.lines.forEach((line, index) => {
        // ВАЖНО: Для режима проверки используем confirmed_qty и confirmed
        // collected_qty и checked - это для режима сборки, их не трогаем!
        // Для отображения в режиме проверки показываем собранное количество (collected_qty) для удобства,
        // но для определения подтверждения используем только confirmed
        const hasConfirmedQty = line.confirmed_qty !== undefined && line.confirmed_qty !== null;
        // Для отображения используем собранное количество (collected_qty), если confirmed_qty не установлен
        // Это позволяет видеть, сколько собрано, даже если еще не подтверждено
        const displayQty = hasConfirmedQty 
          ? line.confirmed_qty 
          : (line.collected_qty !== undefined && line.collected_qty !== null 
              ? line.collected_qty 
              : line.qty); // По умолчанию показываем собранное количество или требуемое
        
        // ВАЖНО: Используем confirmed из данных как ЕДИНСТВЕННЫЙ источник истины для проверки
        // Если confirmed = true, значит позиция уже проверена проверяльщиком
        // НЕ используем collected_qty или checked для определения подтверждения!
        const isConfirmed = line.confirmed === true;
        
        initialState[index] = {
          qty: line.qty,
          collectedQty: displayQty ?? line.qty, // Показываем подтвержденное/собранное количество или требуемое по умолчанию
          confirmed: isConfirmed, // ТОЛЬКО из поля confirmed, без fallback!
        };
      });
    }
    setChecklistState(initialState);
    setEditState({});
  }, []);

  const closeModal = useCallback(async () => {
    // ПРИНУДИТЕЛЬНО сохраняем все измененные места перед закрытием
    if (currentShipment && Object.keys(changedLocations).length > 0) {
      try {
        console.log('🔵 [useConfirm.closeModal] Сохраняем измененные места перед закрытием:', {
          shipmentId: currentShipment.id,
          changedLocations,
          count: Object.keys(changedLocations).length,
        });
        const savePromises = Object.entries(changedLocations).map(async ([lineIndexStr, location]) => {
          const lineIndex = parseInt(lineIndexStr, 10);
          const line = currentShipment.lines[lineIndex];
          if (line) {
            try {
              console.log(`🟡 [useConfirm.closeModal] Сохранение места для позиции ${lineIndex}:`, {
                sku: line.sku,
                location: location || 'null',
              });
              const response = await fetch(`/api/shipments/${currentShipment.id}/update-location`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  sku: line.sku,
                  location: location || null,
                }),
              });
              if (!response.ok) {
                const errorText = await response.text();
                console.error(`🔴 [useConfirm.closeModal] ОШИБКА при сохранении места для позиции ${lineIndex}:`, {
                  status: response.status,
                  statusText: response.statusText,
                  error: errorText,
                });
                throw new Error(`Ошибка при сохранении места: ${response.status}`);
              }
              const result = await response.json();
              console.log(`🟢 [useConfirm.closeModal] Место сохранено для позиции ${lineIndex} (${line.sku}):`, {
                location: location || 'null',
                apiResponse: result,
              });
            } catch (error) {
              console.error(`🔴 [useConfirm.closeModal] ОШИБКА при сохранении места для позиции ${lineIndex}:`, error);
            }
          }
        });
        await Promise.all(savePromises);
        console.log('🟢 [useConfirm.closeModal] Все измененные места сохранены');
      } catch (error) {
        console.error('🔴 [useConfirm.closeModal] ОШИБКА при сохранении измененных мест:', error);
      }
    }
    
    setCurrentShipment(null);
    setChecklistState({});
    setEditState({});
    setRemovingItems(new Set());
    setChangedLocations({}); // Очищаем список измененных мест
    
    // Обновляем данные на фронтенде после закрытия модального окна
    if (onClose) {
      try {
        await onClose();
      } catch (error) {
        console.error('Ошибка при обновлении данных после закрытия:', error);
      }
    }
  }, [onClose, currentShipment, changedLocations]);

  const updateCollectedQty = useCallback(async (lineIndex: number, qty: number) => {
    if (!currentShipment) return;
    
    const line = currentShipment.lines[lineIndex];
    const maxQty = line.qty;
    const newQty = Math.min(Math.max(0, Math.floor(qty)), maxQty);

    // Используем функциональное обновление для получения актуального состояния
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
      
      // Сохраняем прогресс ПРОВЕРКИ в БД (отдельно от прогресса сборки)
      // ВАЖНО: Используем confirmed_qty и confirmed, а не collected_qty и checked!
      const taskId = currentShipment.task_id || currentShipment.id; // taskId для режима подтверждения
      const linesData = currentShipment.lines.map((l, idx) => {
        const state = newState[idx];
        // Сохраняем confirmed_qty только для текущей позиции (lineIndex)
        // Для остальных позиций оставляем текущее значение из БД
        if (idx === lineIndex && state) {
          // Текущая позиция - сохраняем новое значение
          const qty = state.collectedQty !== null && state.collectedQty !== undefined 
            ? state.collectedQty 
            : (l.confirmed_qty !== undefined ? l.confirmed_qty : null);
          return {
            sku: l.sku,
            confirmed_qty: qty && qty > 0 ? qty : null,
            confirmed: state.confirmed ? true : (l.confirmed === true), // Сохраняем confirmed только если позиция подтверждена
          };
        } else {
          // Остальные позиции - оставляем текущее значение из БД (не меняем)
          return {
            sku: l.sku,
            confirmed_qty: l.confirmed_qty !== undefined ? l.confirmed_qty : null,
            confirmed: l.confirmed === true, // Сохраняем текущее значение confirmed
          };
        }
      });
      
      console.log(`[useConfirm] Сохраняем прогресс ПРОВЕРКИ для позиции ${lineIndex}:`, {
        newQty,
        taskId,
        linesData: linesData.map(l => ({ sku: l.sku, confirmed_qty: l.confirmed_qty }))
      });
      
      // Сохраняем асинхронно через новый API для прогресса проверки
      shipmentsApi.saveConfirmationProgress(taskId, { lines: linesData })
        .then((response) => {
          console.log(`[useConfirm] Прогресс ПРОВЕРКИ сохранен для позиции ${lineIndex}:`, response);
        })
        .catch((error) => {
          console.error('[useConfirm] Ошибка при сохранении прогресса ПРОВЕРКИ:', error);
        });
      
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
      
      // Сохраняем прогресс ПРОВЕРКИ после редактирования
      const taskId = currentShipment.task_id || currentShipment.id;
      const linesData = currentShipment.lines.map((l, idx) => {
        const state = newState[idx];
        // Сохраняем confirmed_qty только для текущей позиции (lineIndex)
        // Для остальных позиций оставляем текущее значение из БД
        if (idx === lineIndex && state) {
          // Текущая позиция - сохраняем новое значение (промежуточный прогресс)
          const qty = state.collectedQty !== null && state.collectedQty !== undefined 
            ? state.collectedQty 
            : (l.confirmed_qty !== undefined ? l.confirmed_qty : null);
          return {
            sku: l.sku,
            confirmed_qty: qty && qty > 0 ? qty : null,
            confirmed: state.confirmed ? true : (l.confirmed === true), // Сохраняем confirmed только если позиция подтверждена
          };
        } else {
          // Остальные позиции - оставляем текущее значение из БД (не меняем)
          return {
            sku: l.sku,
            confirmed_qty: l.confirmed_qty !== undefined ? l.confirmed_qty : null,
            confirmed: l.confirmed === true, // Сохраняем текущее значение confirmed
          };
        }
      });
      
      shipmentsApi.saveConfirmationProgress(taskId, { lines: linesData })
        .then((response) => {
          console.log(`[useConfirm] Прогресс ПРОВЕРКИ сохранен после редактирования позиции ${lineIndex}:`, response);
        })
        .catch((error) => {
          console.error('[useConfirm] Ошибка при сохранении прогресса ПРОВЕРКИ после редактирования:', error);
        });
      
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
          collectedQty: line.confirmed_qty !== undefined ? line.confirmed_qty : (line.collected_qty !== undefined ? line.collected_qty : line.qty),
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

  const updateLocation = useCallback(async (lineIndex: number, location: string) => {
    if (!currentShipment) {
      console.error('🔴 [useConfirm.updateLocation] ОШИБКА: currentShipment отсутствует');
      return;
    }
    
    const line = currentShipment.lines[lineIndex];
    if (!line) {
      console.error(`🔴 [useConfirm.updateLocation] ОШИБКА: Позиция ${lineIndex} не найдена`);
      return;
    }

    const oldLocation = line.location || 'null';
    console.log(`🔵 [useConfirm.updateLocation] НАЧАЛО обновления места:`, {
      shipmentId: currentShipment.id,
      lineIndex,
      sku: line.sku,
      oldLocation,
      newLocation: location || 'null',
    });

    // Обновляем location в локальном состоянии shipment
    setCurrentShipment((prev) => {
      if (!prev) return prev;
      const newLines = [...prev.lines];
      newLines[lineIndex] = {
        ...newLines[lineIndex],
        location: location || undefined,
      };
      console.log(`🟡 [useConfirm.updateLocation] Локальное состояние обновлено:`, {
        lineIndex,
        newLocation: newLines[lineIndex].location || 'null',
      });
      return {
        ...prev,
        lines: newLines,
      };
    });

    // Добавляем в список измененных мест для принудительного сохранения при закрытии
    setChangedLocations((prev) => {
      const updated = {
        ...prev,
        [lineIndex]: location,
      };
      console.log(`🟡 [useConfirm.updateLocation] Добавлено в changedLocations:`, updated);
      return updated;
    });

    // СТРОГОЕ и ПРИНУДИТЕЛЬНОЕ сохранение location в БД через API сразу
    try {
      const shipmentId = currentShipment.id;
      console.log(`🟡 [useConfirm.updateLocation] Отправка запроса в API:`, {
        shipmentId,
        sku: line.sku,
        location: location || null,
      });

      const response = await fetch(`/api/shipments/${shipmentId}/update-location`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sku: line.sku,
          location: location || null,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🔴 [useConfirm.updateLocation] ОШИБКА API:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Ошибка при сохранении места: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`🟢 [useConfirm.updateLocation] Место УСПЕШНО сохранено в БД:`, {
        lineIndex,
        sku: line.sku,
        oldLocation,
        newLocation: location || 'null',
        apiResponse: result,
      });

      // Проверяем, что API вернул правильное место
      if (result.location !== (location || null)) {
        console.error(`🔴 [useConfirm.updateLocation] КРИТИЧЕСКАЯ ОШИБКА: API вернул неправильное место!`, {
          expected: location || null,
          actual: result.location,
        });
      }
    } catch (error) {
      console.error('🔴 [useConfirm.updateLocation] ОШИБКА при сохранении места:', error);
      showError('Не удалось сохранить место');
      // Не удаляем из changedLocations, чтобы попытаться сохранить при закрытии
    }
  }, [currentShipment, showError]);

  const confirmItem = useCallback((lineIndex: number) => {
    // Помечаем товар как "улетающий" и запускаем анимацию
    setRemovingItems((prev) => new Set(prev).add(lineIndex));
    
    // Через 500мс обновляем состояние и убираем из списка удаляемых
    setTimeout(() => {
      setChecklistState((prev) => {
        const newState = { ...prev };
        if (!newState[lineIndex]) {
          const line = currentShipment?.lines[lineIndex];
          if (line) {
            newState[lineIndex] = {
              qty: line.qty,
              collectedQty: line.confirmed_qty !== undefined ? line.confirmed_qty : (line.collected_qty !== undefined ? line.collected_qty : line.qty),
              confirmed: false,
            };
          }
        }
        if (newState[lineIndex]) {
          newState[lineIndex].confirmed = true;
        }
        
        // Сохраняем прогресс ПРОВЕРКИ после подтверждения товара
        if (currentShipment) {
          const taskId = currentShipment.task_id || currentShipment.id;
          const linesData = currentShipment.lines.map((l, idx) => {
            const state = newState[idx];
            // ВАЖНО: Сохраняем confirmed_qty и confirmed ТОЛЬКО для подтвержденной позиции (lineIndex)
            // Для остальных позиций сохраняем текущее значение из БД (не меняем)
            if (idx === lineIndex && state && state.confirmed) {
              // Текущая позиция подтверждена - сохраняем confirmed_qty и confirmed = true
              const qty = state.collectedQty !== null && state.collectedQty !== undefined 
                ? state.collectedQty 
                : (l.confirmed_qty !== undefined ? l.confirmed_qty : null);
              return {
                sku: l.sku,
                confirmed_qty: qty && qty > 0 ? qty : null,
                confirmed: true, // Явно указываем, что позиция подтверждена
              };
            } else {
              // Остальные позиции - оставляем текущее значение из БД (не меняем)
              return {
                sku: l.sku,
                confirmed_qty: l.confirmed_qty !== undefined ? l.confirmed_qty : null,
                confirmed: l.confirmed === true, // Сохраняем текущее значение confirmed
              };
            }
          });
          
          shipmentsApi.saveConfirmationProgress(taskId, { lines: linesData })
            .then((response) => {
              console.log(`[useConfirm] Прогресс ПРОВЕРКИ сохранен после подтверждения позиции ${lineIndex}:`, response);
            })
            .catch((error) => {
              console.error('[useConfirm] Ошибка при сохранении прогресса ПРОВЕРКИ после подтверждения:', error);
            });
        }
        
        return newState;
      });
      
      setRemovingItems((prev) => {
        const next = new Set(prev);
        next.delete(lineIndex);
        return next;
      });
    }, 500);
  }, [currentShipment]);

  const confirmShipment = useCallback(async (comment?: string, places?: number) => {
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

      const requestData: {
        lines: Array<{ sku: string; collected_qty: number; checked: boolean }>;
        comment?: string;
        places?: number;
      } = {
        lines: linesData,
      };

      // Добавляем комментарий и количество мест, если они переданы
      if (comment !== undefined) {
        requestData.comment = comment;
      }
      if (places !== undefined) {
        requestData.places = places;
      }

      const response = await shipmentsApi.confirmShipment(currentShipment.id, requestData);

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

  const confirmAll = useCallback(async (shipment: Shipment, comment?: string, places?: number) => {
    try {
      const linesData = shipment.lines.map((line) => ({
        sku: line.sku,
        collected_qty: line.collected_qty !== undefined ? line.collected_qty : line.qty,
        checked: true,
      }));

      const requestData: {
        lines: Array<{ sku: string; collected_qty: number; checked: boolean }>;
        comment?: string;
        places?: number;
      } = {
        lines: linesData,
      };

      // Добавляем комментарий и количество мест, если они переданы
      if (comment !== undefined) {
        requestData.comment = comment;
      }
      if (places !== undefined) {
        requestData.places = places;
      }

      const response = await shipmentsApi.confirmShipment(shipment.id, requestData);

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
    removingItems,
    isOpen: currentShipment !== null,
    openModal,
    closeModal,
    updateCollectedQty,
    updateLocation,
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

