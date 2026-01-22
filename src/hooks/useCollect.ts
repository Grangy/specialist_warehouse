'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import type { Shipment, ShipmentLine, CollectChecklistState } from '@/types';
import { useToast } from './useToast';

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
  const [removingItems, setRemovingItems] = useState<Set<number>>(new Set());
  const [changedLocations, setChangedLocations] = useState<Record<number, string>>({}); // Отслеживаем измененные места
  const { showToast, showError, showSuccess } = useToast();
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

    console.log('[useCollect] Heartbeat запущен для задания:', shipmentId);
  }, []);

  // Функция для остановки heartbeat
  const stopHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
      console.log('[useCollect] Heartbeat остановлен');
    }
  }, []);

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
      
      // Логируем данные заказа для отладки, ВКЛЮЧАЯ location
      console.log('🔵 [useCollect.openModal] Данные заказа для инициализации:', {
        id: actualShipment.id,
        number: actualShipment.number || actualShipment.shipment_number,
        linesCount: actualShipment.lines?.length || 0,
        lines: actualShipment.lines?.map((line: any, idx: number) => ({
          index: idx,
          sku: line.sku,
          qty: line.qty,
          location: line.location || 'null',
          collected_qty: line.collected_qty,
          checked: line.checked,
        })) || []
      });
      
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
          
          // Аудит: логируем нулевые позиции
          if (hasSavedQty && line.collected_qty === 0) {
            console.log(`[useCollect] Загружена нулевая позиция ${index} (${line.sku}): collected_qty=0, checked=${isChecked}`);
          }
          
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
  }, [currentShipment, showError, startHeartbeat]);

  const closeModal = useCallback(async () => {
    // Останавливаем heartbeat
    stopHeartbeat();
    
    // ПРИНУДИТЕЛЬНО сохраняем все измененные места перед закрытием
    if (currentShipment && Object.keys(changedLocations).length > 0) {
      try {
        console.log('🔵 [useCollect.closeModal] Сохраняем измененные места перед закрытием:', {
          shipmentId: currentShipment.id,
          changedLocations,
          count: Object.keys(changedLocations).length,
        });
        const savePromises = Object.entries(changedLocations).map(async ([lineIndexStr, location]) => {
          const lineIndex = parseInt(lineIndexStr, 10);
          const line = currentShipment.lines[lineIndex];
          if (line) {
            try {
              console.log(`🟡 [useCollect.closeModal] Сохранение места для позиции ${lineIndex}:`, {
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
                console.error(`🔴 [useCollect.closeModal] ОШИБКА при сохранении места для позиции ${lineIndex}:`, {
                  status: response.status,
                  statusText: response.statusText,
                  error: errorText,
                });
                throw new Error(`Ошибка при сохранении места: ${response.status}`);
              }
              const result = await response.json();
              console.log(`🟢 [useCollect.closeModal] Место сохранено для позиции ${lineIndex} (${line.sku}):`, {
                location: location || 'null',
                apiResponse: result,
              });
            } catch (error) {
              console.error(`🔴 [useCollect.closeModal] ОШИБКА при сохранении места для позиции ${lineIndex}:`, error);
            }
          }
        });
        await Promise.all(savePromises);
        console.log('🟢 [useCollect.closeModal] Все измененные места сохранены');
      } catch (error) {
        console.error('🔴 [useCollect.closeModal] ОШИБКА при сохранении измененных мест:', error);
      }
    }
    
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
    setChangedLocations({}); // Очищаем список измененных мест
    
    // Обновляем данные на фронтенде после закрытия модального окна
    if (onClose) {
      try {
        await onClose();
      } catch (error) {
        console.error('Ошибка при обновлении данных после закрытия:', error);
      }
    }
  }, [lockedShipmentId, onClose, stopHeartbeat, currentShipment, changedLocations]);

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
              
              // Аудит: логируем нулевые позиции
              if (state.collected && qty === 0) {
                console.log(`[useCollect] Сохраняем нулевую позицию ${idx} (${line.sku}): collected_qty=0, checked=true`);
              }
              
              return {
                sku: line.sku,
                collected_qty: qty, // Может быть 0, 1, 2, ... или null
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
            
            // Аудит: логируем нулевые позиции
            if (qty === 0) {
              console.log(`[useCollect] Сохраняем нулевую позицию при отмене ${idx} (${line.sku}): collected_qty=0, checked=${state.collected}`);
            }
            
            return {
              sku: line.sku,
              collected_qty: qty, // Может быть 0, 1, 2, ... или null
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
      // ВАЖНО: collectedQty может быть 0 - это валидное значение!
      const collectedQty = state.collectedQty !== undefined && state.collectedQty !== null 
        ? state.collectedQty  // Может быть 0, 1, 2, ...
        : null;
      
      const linesData = [{
        sku: line.sku,
        collected_qty: collectedQty, // Может быть 0, 1, 2, ... или null
        checked: state.collected || false, // Явно передаем checked
      }];
      
      // Аудит: логируем нулевые позиции
      if (collectedQty === 0) {
        console.log(`[useCollect] Сохраняем нулевую позицию после редактирования ${lineIndex} (${line.sku}): collected_qty=0, checked=${state.collected}`);
      }
      
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

  const updateLocation = useCallback(async (lineIndex: number, location: string) => {
    if (!currentShipment) {
      console.error('🔴 [useCollect.updateLocation] ОШИБКА: currentShipment отсутствует');
      return;
    }
    
    const line = currentShipment.lines[lineIndex];
    if (!line) {
      console.error(`🔴 [useCollect.updateLocation] ОШИБКА: Позиция ${lineIndex} не найдена`);
      return;
    }

    const oldLocation = line.location || 'null';
    console.log(`🔵 [useCollect.updateLocation] НАЧАЛО обновления места:`, {
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
      console.log(`🟡 [useCollect.updateLocation] Локальное состояние обновлено:`, {
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
      console.log(`🟡 [useCollect.updateLocation] Добавлено в changedLocations:`, updated);
      return updated;
    });

    // СТРОГОЕ и ПРИНУДИТЕЛЬНОЕ сохранение location в БД через API сразу
    try {
      console.log(`🟡 [useCollect.updateLocation] Отправка запроса в API:`, {
        shipmentId: currentShipment.id,
        sku: line.sku,
        location: location || null,
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
        console.error(`🔴 [useCollect.updateLocation] ОШИБКА API:`, {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(`Ошибка при сохранении места: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`🟢 [useCollect.updateLocation] Место УСПЕШНО сохранено в БД:`, {
        lineIndex,
        sku: line.sku,
        oldLocation,
        newLocation: location || 'null',
        apiResponse: result,
      });

      // Проверяем, что API вернул правильное место
      if (result.location !== (location || null)) {
        console.error(`🔴 [useCollect.updateLocation] КРИТИЧЕСКАЯ ОШИБКА: API вернул неправильное место!`, {
          expected: location || null,
          actual: result.location,
        });
      }
    } catch (error) {
      console.error('🔴 [useCollect.updateLocation] ОШИБКА при сохранении места:', error);
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
        
        // ВАЖНО: Если товар отмечен как собранный, сохраняем количество (включая 0!)
        // Если не собран, сохраняем null
        // НЕ используем || для collectedQty, так как 0 - это валидное значение!
        let qty: number | null = null;
        if (state.collected) {
          // Если собран, сохраняем collectedQty (может быть 0)
          // Используем ?? вместо ||, чтобы 0 не заменялся на line.qty
          qty = state.collectedQty ?? line.qty;
        }
        
        // Аудит: логируем нулевые позиции
        if (state.collected && qty === 0) {
          console.log(`[useCollect] Сохраняем нулевую позицию при финальном подтверждении ${idx} (${line.sku}): collected_qty=0, checked=true`);
        }
        
        return {
          sku: line.sku,
          collected_qty: qty, // Может быть 0, 1, 2, ... или null
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

