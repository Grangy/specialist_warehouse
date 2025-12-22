'use client';

import { useState, useCallback, useRef } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ShipmentLine, CollectChecklistState } from '@/types';
import { useToast } from './useToast';

interface UseCollectOptions {
  onClose?: () => void | Promise<void>;
}

export function useCollect(options?: UseCollectOptions) {
  const { onClose } = options || {};
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(null);
  const [checklistState, setChecklistState] = useState<Record<number, CollectChecklistState>>({});
  const [editState, setEditState] = useState<Record<number, boolean>>({});
  const [lockedShipmentId, setLockedShipmentId] = useState<string | null>(null);
  const [removingItems, setRemovingItems] = useState<Set<number>>(new Set());
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
      let lockResponse;
      try {
        lockResponse = await shipmentsApi.lock(shipment.id);
        console.log('Ответ блокировки:', lockResponse);
      } catch (error: any) {
        // Обрабатываем ошибку блокировки (например, 409 Conflict)
        console.error('[useCollect] Ошибка блокировки:', error);
        console.error('[useCollect] Тип ошибки:', typeof error);
        console.error('[useCollect] Содержимое ошибки:', JSON.stringify(error, null, 2));
        
        // Извлекаем сообщение из ошибки
        let message = 'Задание уже начато другим сборщиком. Только администратор может вмешаться в сборку.';
        
        // APIError имеет структуру { message: string, status?: number }
        if (error?.message) {
          message = error.message;
        } else if (typeof error === 'string') {
          message = error;
        }
        
        console.log('[useCollect] Показываем ошибку пользователю:', message);
        showError(message);
        return;
      }
      
      if (!lockResponse || !lockResponse.success) {
        const message = lockResponse?.message || 'Задание уже заблокировано другим пользователем. Только администратор может вмешаться в сборку.';
        showError(message);
        return;
      }

      console.log('Блокировка успешна, открываем модальное окно');
      
      // Используем переданные данные заказа (они уже актуальны, так как загружаются через useShipments)
      // НЕ вызываем getAll() здесь, чтобы избежать лишних запросов и возможных циклов обновления
      const actualShipment = shipment;
      
      // Логируем данные заказа для отладки
      console.log('[useCollect] Данные заказа для инициализации:', {
        id: actualShipment.id,
        number: actualShipment.number || actualShipment.shipment_number,
        linesCount: actualShipment.lines?.length || 0,
        lines: actualShipment.lines?.map((line: any, idx: number) => ({
          index: idx,
          sku: line.sku,
          qty: line.qty,
          collected_qty: line.collected_qty,
          checked: line.checked,
        })) || []
      });
      
      // Инициализируем состояние чеклиста ПЕРЕД установкой currentShipment
      // Загружаем сохраненный прогресс из БД, если он есть
      const initialState: Record<number, CollectChecklistState> = {};
      if (actualShipment.lines && actualShipment.lines.length > 0) {
        actualShipment.lines.forEach((line, index) => {
          // Используем сохраненное количество из БД, если есть
          // ВАЖНО: для отображения в UI используем сохраненное количество ИЛИ требуемое по умолчанию
          // Но для новых позиций (collected_qty = null) показываем требуемое количество для удобства
          const hasSavedQty = line.collected_qty !== undefined && line.collected_qty !== null;
          const savedQty = hasSavedQty 
            ? line.collected_qty 
            : line.qty; // По умолчанию показываем требуемое количество для удобства пользователя
          
          // Используем checked из данных как основной источник истины
          // Если checked = true, значит позиция уже проверена в сборке
          // Если checked = false или undefined, позиция НЕ собрана, даже если количество установлено
          const isChecked = line.checked === true;
          
          // Позиция считается собранной ТОЛЬКО если:
          // 1. checked = true (явно помечена как проверенная)
          // НЕ используем collected_qty для определения collected, так как пользователь может установить количество, но еще не отметить как собранное
          const isCollected = isChecked;
          
          // Логируем для отладки (только если что-то не так)
          if (isCollected && line.checked !== true) {
            console.warn(`[useCollect] Позиция ${index} (${line.sku}) помечена как собранная некорректно:`, {
              checked: line.checked,
              collected_qty: line.collected_qty,
              savedQty,
              qty: line.qty,
              isChecked,
              isCollected
            });
          }
          
          initialState[index] = {
            collected: isCollected,
            qty: line.qty,
            collectedQty: savedQty ?? line.qty, // Показываем сохраненное количество или требуемое по умолчанию
          };
        });
      }
      
      // Устанавливаем состояние синхронно в правильном порядке
      setChecklistState(initialState);
      setEditState({});
      setLockedShipmentId(actualShipment.id);
      // Устанавливаем currentShipment последним, чтобы isOpen стал true
      setCurrentShipment(actualShipment);
      
      console.log('[useCollect] Состояние модального окна установлено:', {
        shipmentId: actualShipment.id,
        linesCount: actualShipment.lines?.length || 0,
        initialStateKeys: Object.keys(initialState).length
      });
    } catch (error: any) {
      console.error('Ошибка блокировки заказа:', error);
      const errorMessage = error?.message || 'Не удалось заблокировать заказ';
      showError(errorMessage);
    }
  }, [currentShipment, showError]);

  const closeModal = useCallback(async () => {
    // НЕ сохраняем прогресс при закрытии - сохранение происходит только при действии "Сдвиньте" слайдера
    // Это позволяет пользователю закрыть модальное окно без потери несохраненных изменений
    
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
    setRemovingItems(new Set());
    
    // Обновляем данные на фронтенде после закрытия модального окна
    if (onClose) {
      try {
        await onClose();
      } catch (error) {
        console.error('Ошибка при обновлении данных после закрытия:', error);
      }
    }
  }, [lockedShipmentId, onClose]);

  const updateCollected = useCallback(async (lineIndex: number, collected: boolean) => {
    if (collected) {
      // Помечаем товар как "улетающий" и запускаем анимацию
      setRemovingItems((prev) => new Set(prev).add(lineIndex));
      
      // Через 500мс обновляем состояние и убираем из списка удаляемых
      setTimeout(async () => {
        // Используем функциональное обновление для получения актуального состояния
        setChecklistState((prev) => {
          const newState = { ...prev };
          if (!newState[lineIndex]) {
            const line = currentShipment?.lines[lineIndex];
            if (line) {
              newState[lineIndex] = {
                collected: true,
                qty: line.qty,
                collectedQty: line.qty,
              };
            }
          } else {
            newState[lineIndex].collected = true;
            // Если количество не установлено, устанавливаем полное количество
            if (!newState[lineIndex].collectedQty || newState[lineIndex].collectedQty === 0) {
              newState[lineIndex].collectedQty = newState[lineIndex].qty;
            }
          }
          
          // Сохраняем прогресс в БД с актуальным состоянием
          if (currentShipment) {
            const linesData = currentShipment.lines.map((line, idx) => {
              const state = newState[idx] || { collected: false, qty: line.qty, collectedQty: line.qty };
              // Если товар отмечен как собранный, сохраняем количество
              // Если не собран, сохраняем null
              const qty = state.collected ? (state.collectedQty || line.qty) : null;
              return {
                sku: line.sku,
                collected_qty: qty && qty > 0 ? qty : null,
                checked: state.collected || false, // Явно передаем checked
              };
            });
            
            console.log('[useCollect] Сохраняем прогресс после отметки товара:', {
              shipmentId: currentShipment.id,
              linesData: linesData.map(l => ({ sku: l.sku, collected_qty: l.collected_qty }))
            });
            
            // Сохраняем асинхронно, не блокируя обновление UI
            shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
              .then((response) => {
                console.log('[useCollect] Прогресс сохранен после отметки как собранного:', response);
              })
              .catch((error) => {
                console.error('[useCollect] Ошибка при сохранении прогресса:', error);
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
    } else {
      // Если отменяем сборку, сразу обновляем состояние
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
        } else {
          newState[lineIndex].collected = false;
        }
        
        // Сохраняем прогресс при отмене сборки
        if (currentShipment) {
          const linesData = currentShipment.lines.map((line, idx) => {
            const state = newState[idx] || { collected: false, qty: line.qty, collectedQty: line.qty };
            // Если товар не собран, сохраняем null (или текущее количество, если оно было изменено)
            const qty = state.collected ? (state.collectedQty || line.qty) : (state.collectedQty && state.collectedQty > 0 ? state.collectedQty : null);
            return {
              sku: line.sku,
              collected_qty: qty && qty > 0 ? qty : null,
              checked: state.collected || false, // Явно передаем checked
            };
          });
          
          console.log('[useCollect] Сохраняем прогресс после отмены сборки:', {
            shipmentId: currentShipment.id,
            linesData: linesData.map(l => ({ sku: l.sku, collected_qty: l.collected_qty }))
          });
          
          shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
            .then((response) => {
              console.log('[useCollect] Прогресс сохранен после отмены сборки:', response);
            })
            .catch((error) => {
              console.error('[useCollect] Ошибка при сохранении прогресса:', error);
            });
        }
        
        return newState;
      });
    }
  }, [currentShipment]);

  const updateCollectedQty = useCallback((lineIndex: number, qty: number) => {
    if (!currentShipment) return;
    
    const line = currentShipment.lines[lineIndex];
    const maxQty = line.qty;
    const newQty = Math.min(Math.max(0, Math.floor(qty)), maxQty);

    // ВАЖНО: Обновляем только локальное состояние, НЕ сохраняем в БД автоматически
    // Сохранение в БД происходит только при явных действиях:
    // - При отметке товара как собранного (updateCollected)
    // - При подтверждении редактирования (confirmEditQty)
    // - При финальном подтверждении обработки (confirmProcessing)
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
      
      console.log(`[useCollect] Обновлено локальное состояние для позиции ${lineIndex}:`, {
        newQty,
        collected: newState[lineIndex].collected,
        sku: line.sku
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

  const confirmEditQty = useCallback(async (lineIndex: number) => {
    if (!currentShipment) return;
    
    // Выходим из режима редактирования
    setEditState((prev) => {
      const newState = { ...prev };
      delete newState[lineIndex];
      return newState;
    });
    
    // ВАЖНО: Сохраняем прогресс ТОЛЬКО для измененной позиции
    // Используем функциональное обновление для получения актуального состояния
    setChecklistState((prev) => {
      const newState = { ...prev };
      const state = newState[lineIndex];
      const line = currentShipment.lines[lineIndex];
      
      if (!state) {
        console.warn(`[useCollect] confirmEditQty: состояние для позиции ${lineIndex} не найдено`);
        return prev;
      }
      
      // Сохраняем прогресс только для измененной позиции
      // Передаем явно checked, чтобы не устанавливать его автоматически
      const linesData = [{
        sku: line.sku,
        collected_qty: state.collectedQty && state.collectedQty > 0 ? state.collectedQty : null,
        checked: state.collected || false, // Явно передаем checked
      }];
      
      console.log(`[useCollect] Сохраняем прогресс после редактирования позиции ${lineIndex}:`, {
        sku: line.sku,
        collected_qty: linesData[0].collected_qty,
        checked: linesData[0].checked,
        shipmentId: currentShipment.id
      });
      
      // Сохраняем асинхронно, не блокируя обновление UI
      shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
        .then((response) => {
          console.log(`[useCollect] Прогресс сохранен после редактирования позиции ${lineIndex}:`, response);
        })
        .catch((error) => {
          console.error('[useCollect] Ошибка при сохранении прогресса после редактирования:', error);
        });
      
      return newState;
    });
  }, [currentShipment]);

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
    console.log('[useCollect] Начинаем подтверждение обработки для заказа:', shipmentId);

    try {
      // ВАЖНО: Сохраняем прогресс в БД перед отправкой на подтверждение
      // Это происходит при действии "Сдвиньте" слайдера
      console.log('[useCollect] Сохраняем финальный прогресс перед подтверждением...');
      
      // Используем функциональное обновление для получения актуального состояния
      let finalChecklistState = checklistState;
      
      // Сохраняем прогресс с актуальным состоянием
      const progressLinesData = currentShipment.lines.map((line, idx) => {
        const state = finalChecklistState[idx] || { collected: false, qty: line.qty, collectedQty: line.qty };
        // Если товар отмечен как собранный, сохраняем количество
        // Если не собран, сохраняем null
        const qty = state.collected ? (state.collectedQty || line.qty) : null;
        return {
          sku: line.sku,
          collected_qty: qty && qty > 0 ? qty : null,
          checked: state.collected || false, // Явно передаем checked
        };
      });
      
      console.log('[useCollect] Сохраняем финальный прогресс:', {
        shipmentId,
        linesData: progressLinesData.map(l => ({ sku: l.sku, collected_qty: l.collected_qty }))
      });
      
      // Сохраняем прогресс в БД
      const saveResponse = await shipmentsApi.saveProgress(shipmentId, { lines: progressLinesData });
      console.log('[useCollect] Прогресс сохранен в БД перед подтверждением:', saveResponse);

      // Подготавливаем данные для отправки на подтверждение
      const linesData = currentShipment.lines.map((line, index) => ({
        sku: line.sku,
        collected_qty: finalChecklistState[index]?.collectedQty ?? line.qty,
      }));

      console.log('[useCollect] Отправляем данные на подтверждение:', { shipmentId, linesCount: linesData.length });

      const response = await shipmentsApi.markPendingConfirmation(shipmentId, {
        lines: linesData,
      });

      console.log('[useCollect] Заказ успешно отправлен на подтверждение:', response);
      showSuccess('Заказ успешно отправлен на подтверждение');
      
      // Закрываем модальное окно перед возвратом
      await closeModal();
      
      return response;
    } catch (error) {
      console.error('[useCollect] Ошибка подтверждения обработки:', error);
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
    removingItems,
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

