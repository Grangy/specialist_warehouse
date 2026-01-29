'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import { isUrgent } from '@/lib/utils/helpers';
import type { Shipment, Tab, FilterState } from '@/types';
import { useToast } from './useToast';
import { useSSE } from './useSSE';

export function useShipments() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState<Tab>('new');
  const [userRole, setUserRole] = useState<'admin' | 'collector' | 'checker' | null>(null);
  // Загружаем сохраненный склад из localStorage при инициализации
  const getStoredWarehouse = (): string => {
    if (typeof window === 'undefined') return '';
    try {
      const stored = localStorage.getItem('selectedWarehouse');
      return stored || '';
    } catch {
      return '';
    }
  };

  const [filters, setFilters] = useState<FilterState>({
    search: '',
    warehouse: getStoredWarehouse(),
    urgentOnly: false,
  });
  const { showError } = useToast();
  
  // Флаги для предотвращения спама ошибок
  const loadingRef = useRef(false);
  const errorShownRef = useRef(false);
  const retryCountRef = useRef(0);
  const showErrorRef = useRef(showError);
  // ID текущего пользователя для SSE (lockedByCurrentUser и т.д.)
  const userIdRef = useRef<string | null>(null);
  // Таймер debounce для shipment:created
  const createdRefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Обновляем ref при изменении showError
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  // Очистка debounce-таймера при размонтировании
  useEffect(() => {
    return () => {
      if (createdRefetchTimeoutRef.current) {
        clearTimeout(createdRefetchTimeoutRef.current);
        createdRefetchTimeoutRef.current = null;
      }
    };
  }, []);

  const [isAuthorized, setIsAuthorized] = useState(false);

  // Загружаем роль пользователя и проверяем авторизацию
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserRole(data.user.role);
          userIdRef.current = data.user.id ?? null;
          setIsAuthorized(true);
        } else {
          userIdRef.current = null;
          setIsAuthorized(false);
        }
      })
      .catch(() => {
        userIdRef.current = null;
        setIsAuthorized(false);
        // Игнорируем ошибки
      });
  }, []);

  const loadShipments = useCallback(async () => {
    // Не загружаем заказы, если пользователь не авторизован
    if (!isAuthorized) {
      setIsLoading(false);
      return;
    }

    // Предотвращаем параллельные запросы
    if (loadingRef.current) return;
    
    // Сохраняем позицию скролла перед обновлением
    const savedScrollPosition = typeof window !== 'undefined' ? window.scrollY : 0;
    
    try {
      loadingRef.current = true;
      setIsLoading(true);
      errorShownRef.current = false;
      retryCountRef.current = 0;
      
      // Для сборщиков на вкладке 'new' передаем статус 'new', чтобы сервер вернул только задания со статусом 'new' с каждого склада
      const statusParam = (userRole === 'collector' && currentTab === 'new') ? 'new' : undefined;
      const data = await shipmentsApi.getAll(statusParam ? { status: statusParam } : undefined);
      setShipments(data);
      
      // Восстанавливаем позицию скролла после обновления данных
      // Используем requestAnimationFrame для гарантии, что DOM обновлен
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScrollPosition);
        });
      }
    } catch (error: any) {
      // Игнорируем ошибки 401 (не авторизован) - это нормально для незалогиненных пользователей
      if (error?.status === 401) {
        setIsAuthorized(false);
        setIsLoading(false);
        return;
      }
      
      // Показываем ошибку только один раз для других ошибок
      if (!errorShownRef.current) {
        errorShownRef.current = true;
        console.error('Ошибка при загрузке заказов:', error);
        showErrorRef.current('Ошибка загрузки данных, попробуйте обновить страницу');
      }
      
      // Восстанавливаем позицию скролла даже при ошибке
      if (typeof window !== 'undefined') {
        requestAnimationFrame(() => {
          window.scrollTo(0, savedScrollPosition);
        });
      }
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, [isAuthorized, userRole, currentTab]); // Зависим от isAuthorized, userRole и currentTab

  // Подключаемся к SSE для получения обновлений в реальном времени (прогрессивно, без полной перезагрузки)
  useSSE({
    onEvent: (eventType, data) => {
      if (!isAuthorized) return;

      const currentUserId = userIdRef.current;

      if (eventType === 'shipment:locked' && data?.taskId != null) {
        setShipments((prev) =>
          prev.map((item) =>
            item.id === data.taskId
              ? {
                  ...item,
                  locked: true,
                  lockedBy: data.userId ?? null,
                  lockedByCurrentUser: (data.userId ?? null) === currentUserId,
                  collector_id: data.userId ?? undefined,
                  collector_name: data.userName ?? undefined,
                }
              : item
          )
        );
        return;
      }

      if (eventType === 'shipment:unlocked' && data?.taskId != null) {
        setShipments((prev) =>
          prev.map((item) =>
            item.id === data.taskId
              ? {
                  ...item,
                  locked: false,
                  lockedBy: null,
                  lockedByCurrentUser: false,
                  collector_id: undefined,
                  collector_name: undefined,
                }
              : item
          )
        );
        return;
      }

      if (eventType === 'shipment:status_changed' && data?.id != null) {
        const shipmentId = data.id;
        const status = data.status;
        if (status === 'processed') {
          // Заказ полностью подтверждён — убираем все его задания из списка (блок исчезает без перезагрузки)
          setShipments((prev) => prev.filter((item) => item.shipment_id !== shipmentId));
        } else {
          setShipments((prev) =>
            prev.map((item) =>
              item.shipment_id === shipmentId ? { ...item, status } : item
            )
          );
        }
        return;
      }

      if (eventType === 'shipment:updated' && data?.taskId != null) {
        const status = data.status ?? 'pending_confirmation';
        setShipments((prev) =>
          prev.map((item) =>
            item.id === data.taskId ? { ...item, status } : item
          )
        );
        // Обновляем только один блок (статус/ответственный уже выше), без перезагрузки списка
        return;
      }

      if (eventType === 'shipment:created') {
        // Новый заказ — один раз подтягиваем список через debounce, без перерисовки всех блоков
        if (createdRefetchTimeoutRef.current) {
          clearTimeout(createdRefetchTimeoutRef.current);
        }
        createdRefetchTimeoutRef.current = setTimeout(() => {
          createdRefetchTimeoutRef.current = null;
          loadShipments();
        }, 3000);
        return;
      }
    },
    onError: (error) => {
      console.error('[useShipments] Ошибка SSE:', error);
    },
  });

  useEffect(() => {
    // Загружаем заказы только если пользователь авторизован. Дальше обновления — по SSE и по кнопке «Обновить».
    if (!isAuthorized) {
      setIsLoading(false);
      return;
    }

    loadShipments();
  }, [isAuthorized, loadShipments]);

  // Контроль доступа к вкладкам
  const canAccessTab = (tab: Tab): boolean => {
    if (!userRole) return false;
    if (userRole === 'admin') return true;
    if (userRole === 'collector') return tab === 'new';
    if (userRole === 'checker') return tab === 'new' || tab === 'processed' || tab === 'waiting' || tab === 'regions';
    return false;
  };

  // Автоматически переключаемся на доступную вкладку
  useEffect(() => {
    if (userRole && !canAccessTab(currentTab)) {
      if (userRole === 'collector') {
        setCurrentTab('new');
      } else if (userRole === 'checker') {
        setCurrentTab('new');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, currentTab]);

  const filteredShipments = useMemo(() => {
    // Для режима ожидания группируем задания по shipment_id
    if (currentTab === 'waiting') {
      const groupedByShipment = new Map<string, Shipment[]>();
      
      shipments.forEach((shipment) => {
        if (shipment.shipment_id) {
          const key = shipment.shipment_id;
          if (!groupedByShipment.has(key)) {
            groupedByShipment.set(key, []);
          }
          groupedByShipment.get(key)!.push(shipment);
        }
      });
      
      // Создаем заказы с их заданиями
      const waitingShipments: Shipment[] = [];
      groupedByShipment.forEach((tasks, shipmentId) => {
        const firstTask = tasks[0];
        const confirmedTasks = tasks.filter(t => t.status === 'processed');
        const totalTasks = tasks.length;
        
        // Показываем только если есть подтвержденные задания, но не все
        if (confirmedTasks.length > 0 && confirmedTasks.length < totalTasks) {
          waitingShipments.push({
            ...firstTask,
            id: shipmentId,
            shipment_id: shipmentId,
            shipment_number: firstTask.shipment_number || firstTask.number,
            number: firstTask.shipment_number || firstTask.number,
            tasks: tasks.map(t => ({
              id: t.id || t.task_id || '',
              warehouse: t.warehouse,
              status: t.status,
              collector_name: t.collector_name,
              created_at: t.created_at,
            })),
            tasks_progress: {
              confirmed: confirmedTasks.length,
              total: totalTasks,
            },
          });
        }
      });
      
      const filtered = waitingShipments.filter((shipment) => {
        // Фильтр по поиску
        if (filters.search) {
          const searchLower = filters.search.toLowerCase();
          const number = shipment.number || shipment.shipment_number || '';
          if (
            !number.toLowerCase().includes(searchLower) &&
            !shipment.customer_name.toLowerCase().includes(searchLower)
          ) {
            return false;
          }
        }

        // Фильтр по складу
        // Если выбран конкретный склад, фильтруем по нему
        // Если выбрано "Все склады" (filters.warehouse === ""), показываем все задания
        if (filters.warehouse && shipment.warehouse !== filters.warehouse) {
          return false;
        }

        // Фильтр по срочности
        if (filters.urgentOnly && !isUrgent(shipment.comment)) {
          return false;
        }

        return true;
      });

      // НЕ сортируем на фронтенде, так как сервер уже отсортировал задания
      // по приоритету регионов (согласно дням недели) и дате создания
      // Возвращаем задания в том порядке, как их вернул сервер
      return filtered;
    }
    
    const filtered = shipments.filter((shipment) => {
      // АУДИТ: Логируем каждое задание для сборщиков
      if (userRole === 'collector') {
        console.log(`[COLLECTOR FILTER AUDIT] Проверяем задание:`, {
          warehouse: shipment.warehouse,
          status: shipment.status,
          currentTab,
          number: shipment.number || shipment.shipment_number,
        });
      }
      
      // Фильтр по вкладке
      // Теперь работаем с заданиями, а не заказами
      if (currentTab === 'new' && shipment.status !== 'new') {
        if (userRole === 'collector') {
          console.log(`[COLLECTOR FILTER AUDIT] Отфильтровано по статусу: currentTab=${currentTab}, shipment.status=${shipment.status}`);
        }
        return false;
      }
      if (currentTab === 'processed' && shipment.status !== 'pending_confirmation') {
        if (userRole === 'collector') {
          console.log(`[COLLECTOR FILTER AUDIT] Отфильтровано по статусу: currentTab=${currentTab}, shipment.status=${shipment.status}`);
        }
        return false;
      }

      // Фильтр по поиску
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const number = shipment.number || shipment.shipment_number || '';
        if (
          !number.toLowerCase().includes(searchLower) &&
          !shipment.customer_name.toLowerCase().includes(searchLower)
        ) {
          if (userRole === 'collector') {
            console.log(`[COLLECTOR FILTER AUDIT] Отфильтровано по поиску: "${filters.search}"`);
          }
          return false;
        }
      }

        // Фильтр по складу
        // Если выбран конкретный склад, фильтруем по нему
        // Если выбрано "Все склады" (filters.warehouse === ""), показываем все задания
        if (filters.warehouse && shipment.warehouse !== filters.warehouse) {
          return false;
        }

      // Фильтр по срочности
      if (filters.urgentOnly && !isUrgent(shipment.comment)) {
        if (userRole === 'collector') {
          console.log(`[COLLECTOR FILTER AUDIT] Отфильтровано по срочности`);
        }
        return false;
      }

      if (userRole === 'collector') {
        console.log(`[COLLECTOR FILTER AUDIT] Задание прошло все фильтры:`, {
          warehouse: shipment.warehouse,
          status: shipment.status,
        });
      }

      return true;
    });
    
    // АУДИТ: Логируем для сборщиков
    if (userRole === 'collector') {
      const warehousesInFiltered = new Set(filtered.map(s => s.warehouse).filter(Boolean));
      console.log(`[COLLECTOR FRONTEND AUDIT] userRole: ${userRole}, Получено заданий: ${shipments.length}, После фильтрации: ${filtered.length}, Складов: ${warehousesInFiltered.size} (${Array.from(warehousesInFiltered).join(', ')})`);
      console.log(`[COLLECTOR FRONTEND AUDIT] filters.warehouse: "${filters.warehouse}", Все задания:`, shipments.map(s => ({ warehouse: s.warehouse, number: s.number })));
    }

    // НЕ сортируем на фронтенде, так как сервер уже отсортировал задания
    // по приоритету регионов (согласно дням недели) и дате создания
    // Возвращаем задания в том порядке, как их вернул сервер
    return filtered;
  }, [shipments, currentTab, filters, userRole]);

  const warehouses = useMemo(() => {
    const uniqueWarehouses = new Set<string>();
    shipments.forEach((shipment) => {
      if (shipment.warehouse) {
        uniqueWarehouses.add(shipment.warehouse);
      }
    });
    return Array.from(uniqueWarehouses).sort();
  }, [shipments]);

  const newCount = useMemo(
    () => {
      let filtered = shipments.filter((s) => s.status === 'new');
      // Фильтруем по выбранному складу, если он указан
      // Если выбрано "Все склады" (filters.warehouse === ""), показываем все задания
      if (filters.warehouse) {
        filtered = filtered.filter((s) => s.warehouse === filters.warehouse);
      }
      return filtered.length;
    },
    [shipments, filters.warehouse]
  );

  const pendingCount = useMemo(
    () => {
      let filtered = shipments.filter((s) => s.status === 'pending_confirmation');
      // Фильтруем по выбранному складу, если он указан
      // Если выбрано "Все склады" (filters.warehouse === ""), показываем все задания
      if (filters.warehouse) {
        filtered = filtered.filter((s) => s.warehouse === filters.warehouse);
      }
      return filtered.length;
    },
    [shipments, filters.warehouse]
  );

  const waitingCount = useMemo(
    () => {
      let filtered = shipments.filter((s) => {
        // Заказы в ожидании: есть подтвержденные задания, но не все
        if (!s.tasks_progress) return false;
        const { confirmed, total } = s.tasks_progress;
        return confirmed > 0 && confirmed < total;
      });
      // Фильтруем по выбранному складу, если он указан
      // Если выбрано "Все склады" (filters.warehouse === ""), показываем все задания
      if (filters.warehouse) {
        filtered = filtered.filter((s) => s.warehouse === filters.warehouse);
      }
      return filtered.length;
    },
    [shipments, filters.warehouse]
  );

  // Обертка для setFilters с сохранением склада в localStorage
  const handleFiltersChange = useCallback((newFilters: FilterState) => {
    setFilters(newFilters);
    // Сохраняем выбранный склад в localStorage
    if (typeof window !== 'undefined') {
      try {
        if (newFilters.warehouse) {
          localStorage.setItem('selectedWarehouse', newFilters.warehouse);
        } else {
          localStorage.removeItem('selectedWarehouse');
        }
      } catch (error) {
        console.error('Ошибка при сохранении склада в localStorage:', error);
      }
    }
  }, []);

  return {
    shipments,
    filteredShipments,
    isLoading,
    currentTab,
    setCurrentTab: (tab: Tab) => {
      if (canAccessTab(tab)) {
        setCurrentTab(tab);
      }
    },
    filters,
    setFilters: handleFiltersChange,
    warehouses,
    newCount,
    pendingCount,
    waitingCount,
    refreshShipments: loadShipments,
    userRole,
    canAccessTab,
  };
}
