'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ShipmentLine, CollectChecklistState } from '@/types';
import { useToast } from './useToast';
import { useShipmentsPolling } from '@/contexts/ShipmentsPollingContext';

interface UseCollectOptions {
  onClose?: () => void | Promise<void>;
}

const HEARTBEAT_INTERVAL = 5000; // 5 секунд

export function useCollect(options?: UseCollectOptions) {
  const { onClose } = options || {};
  const [currentShipment, setCurrentShipment] = useState<Shipment | null>(null);
  const [checklistState, setChecklistState] = useState<Record<number, CollectChecklistState>>({});
  const [editState, setEditState] = useState<Record<number, boolean>>({});
  const [lockedShipmentId, setLockedShipmentId] = useState<string | null>(null);
  const [isLocking, setIsLocking] = useState(false); // Ожидание ответа блокировки от сервера
  const [lockingShipmentId, setLockingShipmentId] = useState<string | null>(null); // id заказа, по которому идёт запрос блокировки
  const [removingItems, setRemovingItems] = useState<Set<number>>(new Set());
  const [changedLocations, setChangedLocations] = useState<Record<number, string>>({}); // Отслеживаем измененные места
  const { showToast, showError, showSuccess } = useToast();
  const polling = useShipmentsPolling();
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Функция для запуска heartbeat
  const startHeartbeat = useCallback((shipmentId: string) => {
    // Останавливаем предыдущий интервал, если он есть
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    // Отправляем первый heartbeat сразу
    shipmentsApi.heartbeat(shipmentId).catch((error) => {
      console.error('[useCollect] Ошибка при отправке heartbeat:', error);
    });

    // Устанавливаем интервал для периодической отправки heartbeat
    heartbeatIntervalRef.current = setInterval(() => {
      shipmentsApi.heartbeat(shipmentId).catch((error) => {
        console.error('[useCollect] Ошибка при отправке heartbeat:', error);
      });
    }, HEARTBEAT_INTERVAL);
  }, []);

  // Функция для остановки heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const openModal = useCallback(async (shipment: Shipment, options?: { confirmTakeOver?: boolean }) => {
    // Предотвращаем множественные открытия и повторные клики во время ожидания блокировки
    if (currentShipment !== null || isLocking) {
      return;
    }

    setIsLocking(true);
    setLockingShipmentId(shipment.id);

    try {
      // Блокируем заказ (confirmTakeOver — после подтверждения перехвата на фронте)
      let lockResponse;
      try {
        lockResponse = await shipmentsApi.lock(shipment.id, options);
      } catch (error: any) {
        // CAN_TAKE_OVER — перехват возможен, нужен алерт «Вы точно уверены?»; пробрасываем наверх
        if (error?.code === 'CAN_TAKE_OVER') {
          setIsLocking(false);
          setLockingShipmentId(null);
          throw error;
        }
        // Остальные ошибки блокировки (409 LOCKED_BY_OTHER и др.)
        console.error('[useCollect] Ошибка блокировки:', error);
        let message = 'Задание уже начато другим сборщиком. Только администратор может вмешаться в сборку.';
        if (error?.message) {
          message = error.message;
        } else if (typeof error === 'string') {
          message = error;
        }
        showError(message);
        setIsLocking(false);
        setLockingShipmentId(null);
        return;
      }
      
      if (!lockResponse || !lockResponse.success) {
        const message = lockResponse?.message || 'Задание уже заблокировано другим пользователем. Только администратор может вмешаться в сборку.';
        showError(message);
        setIsLocking(false);
        setLockingShipmentId(null);
        return;
      }
      
      // Используем переданные данные заказа (они уже актуальны, так как загружаются через useShipments)
      // НЕ вызываем getAll() здесь, чтобы избежать лишних запросов и возможных циклов обновления
      const actualShipment = shipment;
      
      // Инициализируем состояние чеклиста ПЕРЕД установкой currentShipment
      // Загружаем сохраненный прогресс из БД, если он есть
      const initialState: Record<number, CollectChecklistState> = {};
      if (actualShipment.lines && actualShipment.lines.length > 0) {
        actualShipment.lines.forEach((line, index) => {
          // ВАЖНО: collected_qty может быть 0 (нулевая позиция) - это валидное значение!
          // null означает, что количество еще не установлено
          // 0 означает, что установлено явно 0 предметов
          const hasSavedQty = line.collected_qty !== undefined && line.collected_qty !== null;
          
          // Используем сохраненное количество из БД, включая 0
          // Если collected_qty = null, значит количество еще не установлено - показываем требуемое для удобства
          const savedQty = hasSavedQty 
            ? line.collected_qty  // Может быть 0, 1, 2, ... или любое другое число
            : line.qty; // По умолчанию показываем требуемое количество для удобства пользователя
          
          // Используем checked из данных как основной источник истины
          // Если checked = true, значит позиция уже проверена в сборке
          // Если checked = false или undefined, позиция НЕ собрана, даже если количество установлено
          const isChecked = line.checked === true;
          
          // Позиция считается собранной ТОЛЬКО если:
          // 1. checked = true (явно помечена как проверенная)
          // НЕ используем collected_qty для определения collected, так как пользователь может установить количество, но еще не отметить как собранное
          const isCollected = isChecked;
          
          // Логируем только если что-то не так
          if (isCollected && line.checked !== true) {
            console.warn(`[useCollect] Позиция ${index} (${line.sku}) помечена как собранная некорректно`);
          }
          
          initialState[index] = {
            collected: isCollected,
            qty: line.qty,
            collectedQty: savedQty ?? line.qty, // Может быть 0 - это валидное значение! Если undefined, используем требуемое количество
          };
        });
      }
      
      // Устанавливаем состояние синхронно в правильном порядке
      setChecklistState(initialState);
      setEditState({});
      setChangedLocations({}); // Очищаем список измененных мест при открытии нового модального окна
      setLockedShipmentId(actualShipment.id);
      // Устанавливаем currentShipment последним, чтобы isOpen стал true
      setCurrentShipment(actualShipment);
      
      // Запускаем heartbeat для отслеживания активности
      startHeartbeat(actualShipment.id);
    } catch (error: any) {
      console.error('[useCollect] Ошибка блокировки заказа:', error);
      const errorMessage = error?.message || 'Не удалось заблокировать заказ';
      showError(errorMessage);
    } finally {
      setIsLocking(false);
      setLockingShipmentId(null);
    }
  }, [currentShipment, isLocking, showError, startHeartbeat]);

  const closeModal = useCallback(async () => {
    // Останавливаем heartbeat
    stopHeartbeat();
    
    // ПРИНУДИТЕЛЬНО сохраняем все измененные места перед закрытием
    if (currentShipment && Object.keys(changedLocations).length > 0) {
      try {
        const savePromises = Object.entries(changedLocations).map(async ([lineIndexStr, location]) => {
          const lineIndex = parseInt(lineIndexStr, 10);
          const line = currentShipment.lines[lineIndex];
          if (line) {
            try {
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
                console.error(`[useCollect] Ошибка при сохранении места для позиции ${lineIndex}:`, {
                  status: response.status,
                  error: errorText,
                });
              }
            } catch (error) {
              console.error(`[useCollect] Ошибка при сохранении места для позиции ${lineIndex}:`, error);
            }
          }
        });
        await Promise.all(savePromises);
      } catch (error) {
        console.error('[useCollect] Ошибка при сохранении измененных мест:', error);
      }
    }
    
    if (lockedShipmentId) {
      try {
        await shipmentsApi.unlock(lockedShipmentId);
      } catch (error: unknown) {
        const msg =
          error != null && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : error instanceof Error
              ? error.message
              : '';
        if (msg && msg !== 'Network error') {
          console.error('Ошибка разблокировки:', msg);
        }
      } finally {
        setLockedShipmentId(null);
        polling?.triggerRefetch();
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
  }, [lockedShipmentId, onClose, stopHeartbeat, currentShipment, changedLocations, polling]);

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
              // Если состояние еще не создано, создаем с требуемым количеством по умолчанию
              newState[lineIndex] = {
                collected: true,
                qty: line.qty,
                collectedQty: line.qty, // По умолчанию полное количество
              };
            }
          } else {
            newState[lineIndex].collected = true;
            // ВАЖНО: Если collectedQty уже установлен (включая 0!), сохраняем его
            // 0 - это валидное значение (нулевая позиция), не заменяем его!
            // Заменяем только если collectedQty не установлен (undefined/null)
            if (newState[lineIndex].collectedQty === undefined || newState[lineIndex].collectedQty === null) {
              // Только если количество не установлено, устанавливаем полное количество
              newState[lineIndex].collectedQty = newState[lineIndex].qty;
            }
            // Если collectedQty = 0, сохраняем 0 (не заменяем!)
          }
          
          // Сохраняем прогресс в БД с актуальным состоянием
          if (currentShipment) {
            const linesData = currentShipment.lines.map((line, idx) => {
              const state = newState[idx] || { collected: false, qty: line.qty, collectedQty: line.qty };
              
              // ВАЖНО: Если товар отмечен как собранный, сохраняем количество (включая 0!)
              // Если не собран, сохраняем null
              // НЕ используем || для collectedQty, так как 0 - это валидное значение!
              let qty: number | null = null;
              if (state.collected) {
                // Если собран, сохраняем collectedQty (может быть 0, 1, 2, ...)
                // Используем ?? вместо ||, чтобы 0 не заменялся на line.qty
                qty = state.collectedQty ?? line.qty;
              }
              
              return {
                sku: line.sku,
                collected_qty: qty, // Может быть 0, 1, 2, ... или null
                checked: state.collected || false, // Явно передаем checked
              };
            });
            
            // Сохраняем асинхронно, не блокируя обновление UI
            shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
              .then(() => polling?.triggerRefetch())
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
            
            // ВАЖНО: Если товар собран, сохраняем collectedQty (включая 0!)
            // Если не собран, но количество было изменено, сохраняем его (включая 0!)
            // Если не собран и количество не изменено, сохраняем null
            let qty: number | null = null;
            if (state.collected) {
              // Собран - сохраняем collectedQty (может быть 0)
              qty = state.collectedQty ?? line.qty;
            } else if (state.collectedQty !== undefined && state.collectedQty !== line.qty) {
              // Не собран, но количество изменено - сохраняем измененное количество (может быть 0)
              qty = state.collectedQty;
            }
            
            return {
              sku: line.sku,
              collected_qty: qty, // Может быть 0, 1, 2, ... или null
              checked: state.collected || false, // Явно передаем checked
            };
          });
          
          shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
            .then(() => polling?.triggerRefetch())
            .catch((error) => {
              console.error('[useCollect] Ошибка при сохранении прогресса:', error);
            });
        }
        
        return newState;
      });
    }
  }, [currentShipment, polling]);

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
      // ВАЖНО: collectedQty может быть 0 - это валидное значение!
      const collectedQty = state.collectedQty !== undefined && state.collectedQty !== null 
        ? state.collectedQty  // Может быть 0, 1, 2, ...
        : null;
      
      const linesData = [{
        sku: line.sku,
        collected_qty: collectedQty, // Может быть 0, 1, 2, ... или null
        checked: state.collected || false, // Явно передаем checked
      }];
      
      // Сохраняем асинхронно, не блокируя обновление UI
      shipmentsApi.saveProgress(currentShipment.id, { lines: linesData })
        .then(() => polling?.triggerRefetch())
        .catch((error) => {
          console.error('[useCollect] Ошибка при сохранении прогресса после редактирования:', error);
        });
      
      return newState;
    });
  }, [currentShipment, polling]);

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

  const updateLocation = useCallback(async (lineIndex: number, location: string) => {
    if (!currentShipment) {
      console.error('[useCollect] Ошибка: currentShipment отсутствует');
      return;
    }
    
    const line = currentShipment.lines[lineIndex];
    if (!line) {
      console.error(`[useCollect] Ошибка: Позиция ${lineIndex} не найдена`);
      return;
    }

    // Обновляем location в локальном состоянии shipment
    setCurrentShipment((prev) => {
      if (!prev) return prev;
      const newLines = [...prev.lines];
      newLines[lineIndex] = {
        ...newLines[lineIndex],
        location: location || undefined,
      };
      return {
        ...prev,
        lines: newLines,
      };
    });

    // Добавляем в список измененных мест для принудительного сохранения при закрытии
    setChangedLocations((prev) => ({
      ...prev,
      [lineIndex]: location,
    }));

    // СТРОГОЕ и ПРИНУДИТЕЛЬНОЕ сохранение location в БД через API сразу
    try {
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
        console.error(`[useCollect] Ошибка API при сохранении места:`, {
          status: response.status,
          error: errorText,
        });
        throw new Error(`Ошибка при сохранении места: ${response.status}`);
      }
    } catch (error) {
      console.error('[useCollect] Ошибка при сохранении места:', error);
      showError('Не удалось сохранить место');
      // Не удаляем из changedLocations, чтобы попытаться сохранить при закрытии
    }
  }, [currentShipment, showError]);

  const confirmProcessing = useCallback(async () => {
    if (!currentShipment) {
      console.error('confirmProcessing вызван без currentShipment');
      return;
    }

    const shipmentId = currentShipment.id;

    try {
      // ВАЖНО: Сохраняем прогресс в БД перед отправкой на подтверждение
      // Используем функциональное обновление для получения актуального состояния
      let finalChecklistState = checklistState;
      
      // Сохраняем прогресс с актуальным состоянием
      const progressLinesData = currentShipment.lines.map((line, idx) => {
        const state = finalChecklistState[idx] || { collected: false, qty: line.qty, collectedQty: line.qty };
        
        // ВАЖНО: Если товар отмечен как собранный, сохраняем количество (включая 0!)
        // Если не собран, сохраняем null
        // НЕ используем || для collectedQty, так как 0 - это валидное значение!
        let qty: number | null = null;
        if (state.collected) {
          // Если собран, сохраняем collectedQty (может быть 0)
          // Используем ?? вместо ||, чтобы 0 не заменялся на line.qty
          qty = state.collectedQty ?? line.qty;
        }
        
        return {
          sku: line.sku,
          collected_qty: qty, // Может быть 0, 1, 2, ... или null
          checked: state.collected || false, // Явно передаем checked
        };
      });
      
      // Сохраняем прогресс в БД
      await shipmentsApi.saveProgress(shipmentId, { lines: progressLinesData });
      polling?.triggerRefetch();

      // Подготавливаем данные для отправки на подтверждение
      const linesData = currentShipment.lines.map((line, index) => ({
        sku: line.sku,
        collected_qty: finalChecklistState[index]?.collectedQty ?? line.qty,
      }));

      const response = await shipmentsApi.markPendingConfirmation(shipmentId, {
        lines: linesData,
      });

      showSuccess('Заказ успешно отправлен на подтверждение');
      
      // Закрываем модальное окно перед возвратом
      await closeModal();
      
      // Возвращаем данные для модального окна завершенной сборки
      // response может содержать tasks_progress из API
      return {
        ...response,
        shipment: currentShipment, // Сохраняем данные о заказе
        tasks_progress: (response as any)?.tasks_progress || currentShipment.tasks_progress,
      };
    } catch (error) {
      console.error('[useCollect] Ошибка подтверждения обработки:', error);
      showError('Не удалось подтвердить обработку заказа');
      throw error;
    }
  }, [currentShipment, checklistState, closeModal, showSuccess, showError, polling]);

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

  // Обработка закрытия вкладки/приложения
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Если модальное окно открыто, пытаемся разблокировать задание
      if (lockedShipmentId) {
        // Останавливаем heartbeat
        stopHeartbeat();
        
        // Пытаемся разблокировать через fetch с keepalive
        // Это более надежно, чем sendBeacon для POST запросов
        try {
          fetch(`/api/shipments/${lockedShipmentId}/unlock`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
            keepalive: true, // Позволяет запросу завершиться даже после закрытия страницы
          }).catch((error) => {
            console.error('[useCollect] Ошибка при разблокировке через fetch:', error);
          });
        } catch (error) {
          console.error('[useCollect] Ошибка при разблокировке:', error);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Вкладка скрыта - останавливаем heartbeat
        // Блокировка станет неактивной через 30 секунд после последнего heartbeat
        console.log('[useCollect] Вкладка скрыта, останавливаем heartbeat');
        stopHeartbeat();
      } else if (lockedShipmentId && currentShipment) {
        // Вкладка снова видима - возобновляем heartbeat
        console.log('[useCollect] Вкладка снова видима, возобновляем heartbeat');
        startHeartbeat(lockedShipmentId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lockedShipmentId, currentShipment, stopHeartbeat, startHeartbeat]);

  // Очистка heartbeat при размонтировании компонента
  useEffect(() => {
    return () => {
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  return {
    currentShipment,
    checklistState,
    editState,
    removingItems,
    isOpen: currentShipment !== null,
    isLocking,
    lockingShipmentId,
    openModal,
    closeModal,
    updateCollected,
    updateCollectedQty,
    updateLocation,
    startEditQty,
    confirmEditQty,
    cancelEditQty,
    confirmProcessing,
    collectAll,
    getProgress,
    isReady,
  };
}

