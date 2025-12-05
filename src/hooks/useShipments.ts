'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { shipmentsApi } from '@/lib/api/shipments';
import { isUrgent } from '@/lib/utils/helpers';
import type { Shipment, Tab, FilterState } from '@/types';
import { useToast } from './useToast';

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

  // Обновляем ref при изменении showError
  useEffect(() => {
    showErrorRef.current = showError;
  }, [showError]);

  // Загружаем роль пользователя
  useEffect(() => {
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setUserRole(data.user.role);
        }
      })
      .catch(() => {
        // Игнорируем ошибки
      });
  }, []);

  const loadShipments = useCallback(async () => {
    // Предотвращаем параллельные запросы
    if (loadingRef.current) return;
    
    try {
      loadingRef.current = true;
      setIsLoading(true);
      errorShownRef.current = false;
      retryCountRef.current = 0;
      
      const data = await shipmentsApi.getAll();
      setShipments(data);
    } catch (error) {
      // Показываем ошибку только один раз
      if (!errorShownRef.current) {
        errorShownRef.current = true;
        console.error('Ошибка при загрузке заказов:', error);
        showErrorRef.current('Ошибка загрузки данных, попробуйте обновить страницу');
      }
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, []); // Пустой массив зависимостей, используем ref для showError

  useEffect(() => {
    loadShipments();
    
    // Автообновление каждые 60 секунд
    const interval = setInterval(() => {
      // Сбрасываем флаг ошибки перед повторной попыткой
      errorShownRef.current = false;
      loadShipments();
    }, 60000);
    return () => clearInterval(interval);
  }, [loadShipments]);

  // Контроль доступа к вкладкам
  const canAccessTab = (tab: Tab): boolean => {
    if (!userRole) return false;
    if (userRole === 'admin') return true;
    if (userRole === 'collector') return tab === 'new';
    if (userRole === 'checker') return tab === 'new' || tab === 'processed';
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
    return shipments.filter((shipment) => {
      // Фильтр по вкладке
      // Теперь работаем с заданиями, а не заказами
      if (currentTab === 'new' && shipment.status !== 'new') return false;
      if (currentTab === 'processed' && shipment.status !== 'pending_confirmation') return false;

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
      if (filters.warehouse && shipment.warehouse !== filters.warehouse) {
        return false;
      }

      // Фильтр по срочности
      if (filters.urgentOnly && !isUrgent(shipment.comment)) {
        return false;
      }

      return true;
    });
  }, [shipments, currentTab, filters]);

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
    () => shipments.filter((s) => s.status === 'new').length,
    [shipments]
  );

  const pendingCount = useMemo(
    () => shipments.filter((s) => s.status === 'pending_confirmation').length,
    [shipments]
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
    refreshShipments: loadShipments,
    userRole,
    canAccessTab,
  };
}
