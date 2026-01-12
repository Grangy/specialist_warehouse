'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { Shipment } from '@/types';

interface SendToOfficeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (places: number) => void;
  shipment: Shipment | null;
}

export function SendToOfficeModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  shipment 
}: SendToOfficeModalProps) {
  const [places, setPlaces] = useState<number>(0);
  const [errors, setErrors] = useState<{ places?: string }>({});
  const [initialPlacesFromTasks, setInitialPlacesFromTasks] = useState<number>(0);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(false);

  // Инициализируем places суммой мест из заданий при открытии модального окна
  // ВАЖНО: Загружаем актуальные данные о заказе с tasks и places из API
  useEffect(() => {
    if (isOpen && shipment) {
      setIsLoadingPlaces(true);
      
      // Загружаем актуальные данные о заказе из API для получения places из заданий
      const loadPlacesFromAPI = async () => {
        try {
          // Получаем актуальные данные о заказе через API details
          const response = await fetch(`/api/shipments/${shipment.id}/details`);
          if (!response.ok) {
            throw new Error('Ошибка загрузки данных о заказе');
          }
          const details = await response.json();
          
          // Вычисляем сумму мест из всех заданий
          let totalPlacesFromTasks = 0;
          if (details.tasks && details.tasks.length > 0) {
            totalPlacesFromTasks = details.tasks.reduce((sum: number, task: any) => {
              // places может быть в task.places или нужно получить из БД
              // Но в details API places не возвращается, нужно использовать другой способ
              return sum + (task.places || 0);
            }, 0);
          }
          
          // Если в details нет places, вычисляем из shipment.tasks (если есть)
          if (totalPlacesFromTasks === 0 && shipment.tasks && shipment.tasks.length > 0) {
            totalPlacesFromTasks = shipment.tasks.reduce((sum: number, task: any) => {
              const taskPlaces = task.places !== undefined ? task.places : 0;
              return sum + (taskPlaces || 0);
            }, 0);
          }
          
          console.log('[SendToOfficeModal] Инициализация мест из API:', {
            shipmentId: shipment.id,
            tasksCount: details.tasks?.length || shipment.tasks?.length || 0,
            tasksFromDetails: details.tasks?.map((t: any) => ({ id: t.id?.substring(0, 8), places: t.places || 0 })) || [],
            tasksFromShipment: shipment.tasks?.map((t: any) => ({ id: t.id?.substring(0, 8), places: t.places || 0 })) || [],
            totalPlacesFromTasks
          });
          
          setInitialPlacesFromTasks(totalPlacesFromTasks);
          setPlaces(totalPlacesFromTasks > 0 ? totalPlacesFromTasks : 0);
          setErrors({});
        } catch (error) {
          console.error('[SendToOfficeModal] Ошибка загрузки данных о заказе:', error);
          // Fallback: используем данные из shipment
          let totalPlacesFromTasks = 0;
          if (shipment.tasks && shipment.tasks.length > 0) {
            totalPlacesFromTasks = shipment.tasks.reduce((sum: number, task: any) => {
              return sum + (task.places || 0);
            }, 0);
          }
          setInitialPlacesFromTasks(totalPlacesFromTasks);
          setPlaces(totalPlacesFromTasks > 0 ? totalPlacesFromTasks : 0);
        } finally {
          setIsLoadingPlaces(false);
        }
      };
      
      loadPlacesFromAPI();
    }
  }, [isOpen, shipment]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Валидация
    const newErrors: { places?: string } = {};
    
    if (places < 1) {
      newErrors.places = 'Количество мест должно быть не менее 1';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Вызываем callback с данными
    onConfirm(places);
  };

  const handleDecrease = () => {
    if (places > 0) {
      setPlaces(places - 1);
      if (errors.places) {
        setErrors(prev => ({ ...prev, places: undefined }));
      }
    }
  };

  const handleIncrease = () => {
    setPlaces(places + 1);
    if (errors.places) {
      setErrors(prev => ({ ...prev, places: undefined }));
    }
  };

  if (!isOpen || !shipment) return null;

  const shipmentNumber = shipment.number || shipment.shipment_number || 'N/A';
  const customerName = shipment.customer_name || 'Не указан';
  const businessRegion = shipment.business_region || 'Не указан';
  const comment = shipment.comment || 'Нет комментария';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="📦 Отправка заказа в офис"
      subtitle={`Заказ ${shipmentNumber} готов к отправке`}
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
          <p className="text-blue-300 text-sm">
            Все задания подтверждены. Перед отправкой заказа в офис укажите количество мест:
          </p>
        </div>

        {/* Информация о заказе */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 space-y-3">
          <div>
            <span className="text-sm font-medium text-slate-400">Клиент:</span>
            <p className="text-slate-200 mt-1">{customerName}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-400">Регион:</span>
            <p className="text-slate-200 mt-1">{businessRegion}</p>
          </div>
          <div>
            <span className="text-sm font-medium text-slate-400">Комментарий:</span>
            <p className="text-slate-200 mt-1">{comment}</p>
          </div>
        </div>

        {/* Количество мест с кнопками +/- */}
        <div>
          <label htmlFor="places" className="block text-sm font-medium text-slate-300 mb-2">
            Количество мест <span className="text-red-400">*</span>
            {initialPlacesFromTasks > 0 && (
              <span className="ml-2 text-xs text-slate-400">
                (сумма из заданий: {initialPlacesFromTasks})
              </span>
            )}
          </label>
          {isLoadingPlaces ? (
            <div className="flex items-center justify-center py-4">
              <div className="text-slate-400 text-sm">Загрузка данных о местах...</div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDecrease}
                disabled={places === 0}
                className="w-12 h-12 flex items-center justify-center bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-slate-100 font-semibold rounded-lg transition-colors border border-slate-600"
              >
                −
              </button>
              <input
                id="places"
                type="number"
                min="0"
                value={places}
                readOnly
                className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-slate-100 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={handleIncrease}
                className="w-12 h-12 flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold rounded-lg transition-colors border border-slate-600"
              >
                +
              </button>
            </div>
          )}
          {errors.places && (
            <p className="mt-1 text-sm text-red-400">{errors.places}</p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3 justify-end pt-4 border-t border-slate-700">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 font-semibold rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={places === 0}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            Отправить в офис
          </button>
        </div>
      </form>
    </Modal>
  );
}

