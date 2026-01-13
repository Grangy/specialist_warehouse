'use client';

import { useState, useEffect } from 'react';
import {
  MapPin,
  Loader2,
  AlertCircle,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Calendar,
  Info,
  CheckCircle2,
  Sparkles,
  Copy,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { XIcon } from '@/components/icons/XIcon';

interface RegionPriority {
  id: string;
  region: string;
  priority: number;
  priorityMonday?: number | null;
  priorityTuesday?: number | null;
  priorityWednesday?: number | null;
  priorityThursday?: number | null;
  priorityFriday?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface RegionList {
  all: string[];
  withPriority: string[];
  withoutPriority: string[];
}

type DayOfWeek = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';

const DAYS_OF_WEEK: { key: DayOfWeek; label: string; short: string; color: string }[] = [
  { key: 'monday', label: 'Понедельник', short: 'Пн', color: 'from-blue-600 to-blue-500' },
  { key: 'tuesday', label: 'Вторник', short: 'Вт', color: 'from-purple-600 to-purple-500' },
  { key: 'wednesday', label: 'Среда', short: 'Ср', color: 'from-pink-600 to-pink-500' },
  { key: 'thursday', label: 'Четверг', short: 'Чт', color: 'from-orange-600 to-orange-500' },
  { key: 'friday', label: 'Пятница', short: 'Пт', color: 'from-green-600 to-green-500' },
];

export default function RegionPrioritiesTab() {
  const [priorities, setPriorities] = useState<RegionPriority[]>([]);
  const [regionList, setRegionList] = useState<RegionList>({
    all: [],
    withPriority: [],
    withoutPriority: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedRegionToAdd, setSelectedRegionToAdd] = useState<string | null>(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError('');
      const [prioritiesRes, regionsRes] = await Promise.all([
        fetch('/api/regions/priorities'),
        fetch('/api/regions/list'),
      ]);

      if (!prioritiesRes.ok || !regionsRes.ok) {
        throw new Error('Ошибка загрузки данных');
      }

      const prioritiesData = await prioritiesRes.json();
      const regionsData = await regionsRes.json();

      setPriorities(prioritiesData);
      setRegionList(regionsData);
      setHasChanges(false);
    } catch (error) {
      console.error('Ошибка при загрузке данных:', error);
      setError('Ошибка при загрузке данных');
    } finally {
      setIsLoading(false);
    }
  };

  const getDayPriority = (priority: RegionPriority, day: DayOfWeek): number | null => {
    switch (day) {
      case 'monday':
        return priority.priorityMonday ?? null;
      case 'tuesday':
        return priority.priorityTuesday ?? null;
      case 'wednesday':
        return priority.priorityWednesday ?? null;
      case 'thursday':
        return priority.priorityThursday ?? null;
      case 'friday':
        return priority.priorityFriday ?? null;
      default:
        return null;
    }
  };

  const getRegionsForDay = (day: DayOfWeek): RegionPriority[] => {
    return [...priorities]
      .filter((p) => {
        const dayPriority = getDayPriority(p, day);
        return dayPriority !== null && dayPriority !== undefined;
      })
      .sort((a, b) => {
        const aPriority = getDayPriority(a, day) ?? 9999;
        const bPriority = getDayPriority(b, day) ?? 9999;
        return aPriority - bPriority;
      });
  };

  // Проверяет, добавлен ли регион во все дни недели
  const isRegionInAllDays = (region: string): boolean => {
    const priority = priorities.find((p) => p.region === region);
    if (!priority) return false;
    
    return (
      (priority.priorityMonday !== null && priority.priorityMonday !== undefined) &&
      (priority.priorityTuesday !== null && priority.priorityTuesday !== undefined) &&
      (priority.priorityWednesday !== null && priority.priorityWednesday !== undefined) &&
      (priority.priorityThursday !== null && priority.priorityThursday !== undefined) &&
      (priority.priorityFriday !== null && priority.priorityFriday !== undefined)
    );
  };

  // Получает список доступных регионов (не добавленных во все дни)
  const getAvailableRegions = (): string[] => {
    return regionList.all.filter((region) => !isRegionInAllDays(region));
  };

  // Перемещение региона вверх в списке дня
  const moveRegionUp = (day: DayOfWeek, regionId: string) => {
    const dayRegions = getRegionsForDay(day);
    const currentIndex = dayRegions.findIndex((r) => r.id === regionId);
    
    if (currentIndex <= 0) return; // Уже наверху или не найден
    
    // Меняем местами приоритеты
    const prevRegion = dayRegions[currentIndex - 1];
    const currentRegion = dayRegions[currentIndex];
    
    const prevPriority = getDayPriority(prevRegion, day) ?? 0;
    const currentPriority = getDayPriority(currentRegion, day) ?? 0;
    
    setPriorities((prev) => {
      return prev.map((p) => {
        if (p.id === prevRegion.id) {
          const updateData: Partial<RegionPriority> = {};
          switch (day) {
            case 'monday':
              updateData.priorityMonday = currentPriority;
              break;
            case 'tuesday':
              updateData.priorityTuesday = currentPriority;
              break;
            case 'wednesday':
              updateData.priorityWednesday = currentPriority;
              break;
            case 'thursday':
              updateData.priorityThursday = currentPriority;
              break;
            case 'friday':
              updateData.priorityFriday = currentPriority;
              break;
          }
          return { ...p, ...updateData };
        }
        if (p.id === currentRegion.id) {
          const updateData: Partial<RegionPriority> = {};
          switch (day) {
            case 'monday':
              updateData.priorityMonday = prevPriority;
              break;
            case 'tuesday':
              updateData.priorityTuesday = prevPriority;
              break;
            case 'wednesday':
              updateData.priorityWednesday = prevPriority;
              break;
            case 'thursday':
              updateData.priorityThursday = prevPriority;
              break;
            case 'friday':
              updateData.priorityFriday = prevPriority;
              break;
          }
          return { ...p, ...updateData };
        }
        return p;
      });
    });
    
    setHasChanges(true);
  };

  // Перемещение региона вниз в списке дня
  const moveRegionDown = (day: DayOfWeek, regionId: string) => {
    const dayRegions = getRegionsForDay(day);
    const currentIndex = dayRegions.findIndex((r) => r.id === regionId);
    
    if (currentIndex < 0 || currentIndex >= dayRegions.length - 1) return; // Уже внизу или не найден
    
    // Меняем местами приоритеты
    const nextRegion = dayRegions[currentIndex + 1];
    const currentRegion = dayRegions[currentIndex];
    
    const nextPriority = getDayPriority(nextRegion, day) ?? 0;
    const currentPriority = getDayPriority(currentRegion, day) ?? 0;
    
    setPriorities((prev) => {
      return prev.map((p) => {
        if (p.id === nextRegion.id) {
          const updateData: Partial<RegionPriority> = {};
          switch (day) {
            case 'monday':
              updateData.priorityMonday = currentPriority;
              break;
            case 'tuesday':
              updateData.priorityTuesday = currentPriority;
              break;
            case 'wednesday':
              updateData.priorityWednesday = currentPriority;
              break;
            case 'thursday':
              updateData.priorityThursday = currentPriority;
              break;
            case 'friday':
              updateData.priorityFriday = currentPriority;
              break;
          }
          return { ...p, ...updateData };
        }
        if (p.id === currentRegion.id) {
          const updateData: Partial<RegionPriority> = {};
          switch (day) {
            case 'monday':
              updateData.priorityMonday = nextPriority;
              break;
            case 'tuesday':
              updateData.priorityTuesday = nextPriority;
              break;
            case 'wednesday':
              updateData.priorityWednesday = nextPriority;
              break;
            case 'thursday':
              updateData.priorityThursday = nextPriority;
              break;
            case 'friday':
              updateData.priorityFriday = nextPriority;
              break;
          }
          return { ...p, ...updateData };
        }
        return p;
      });
    });
    
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError('');
      setSuccess('');

      // Для каждого дня недели пересчитываем приоритеты (0, 1, 2, ...)
      const weeklyPriorities = priorities.map((p) => {
        const result: {
          id: string;
          priorityMonday?: number | null;
          priorityTuesday?: number | null;
          priorityWednesday?: number | null;
          priorityThursday?: number | null;
          priorityFriday?: number | null;
        } = {
          id: p.id,
        };

        // Для каждого дня находим позицию региона и устанавливаем приоритет
        DAYS_OF_WEEK.forEach((day) => {
          const dayRegions = getRegionsForDay(day.key);
          const index = dayRegions.findIndex((r) => r.id === p.id);
          
          if (index !== -1) {
            // Регион есть в этом дне, устанавливаем приоритет = индекс
            switch (day.key) {
              case 'monday':
                result.priorityMonday = index;
                break;
              case 'tuesday':
                result.priorityTuesday = index;
                break;
              case 'wednesday':
                result.priorityWednesday = index;
                break;
              case 'thursday':
                result.priorityThursday = index;
                break;
              case 'friday':
                result.priorityFriday = index;
                break;
            }
          } else {
            // Региона нет в этом дне, устанавливаем null
            switch (day.key) {
              case 'monday':
                result.priorityMonday = null;
                break;
              case 'tuesday':
                result.priorityTuesday = null;
                break;
              case 'wednesday':
                result.priorityWednesday = null;
                break;
              case 'thursday':
                result.priorityThursday = null;
                break;
              case 'friday':
                result.priorityFriday = null;
                break;
            }
          }
        });

        return result;
      });

      const response = await fetch('/api/regions/priorities', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          weeklyPriorities,
        }),
      });

      if (!response.ok) {
        throw new Error('Ошибка при сохранении приоритетов');
      }

      const updatedPriorities = await response.json();
      setPriorities(updatedPriorities);
      setSuccess('Приоритеты успешно сохранены');
      setHasChanges(false);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при сохранении:', error);
      setError('Ошибка при сохранении приоритетов');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRegionClick = (region: string) => {
    setSelectedRegionToAdd(region);
    setShowAddModal(true);
  };

  const handleAddRegion = async (region: string, day: DayOfWeek) => {
    try {
      // Проверяем, существует ли уже регион в БД
      const existingPriority = priorities.find((p) => p.region === region);
      
      let regionId: string;
      let dayPriority: number;

      if (existingPriority) {
        // Регион уже существует, проверяем, не добавлен ли он уже в этот день
        const dayRegions = getRegionsForDay(day);
        if (dayRegions.some((r) => r.id === existingPriority.id)) {
          setError(`Регион "${region}" уже добавлен в ${DAYS_OF_WEEK.find(d => d.key === day)?.label}`);
          setTimeout(() => setError(''), 3000);
          return;
        }
        
        regionId = existingPriority.id;
        dayPriority = dayRegions.length; // Добавляем в конец
      } else {
        // Создаем новый регион БЕЗ инициализации дней недели
        const response = await fetch('/api/regions/priorities', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            region,
            priority: 0, // Базовый приоритет
          }),
        });

        if (!response.ok) {
          throw new Error('Ошибка при создании региона');
        }

        const newPriority = await response.json();
        regionId = newPriority.id;
        dayPriority = 0;
      }

      // Обновляем приоритет для выбранного дня
      setPriorities((prev) => {
        let updated = [...prev];
        const existingIndex = updated.findIndex((p) => p.id === regionId);
        
        if (existingIndex !== -1) {
          // Регион уже существует, обновляем только выбранный день
          const updateData: Partial<RegionPriority> = {};
          switch (day) {
            case 'monday':
              updateData.priorityMonday = dayPriority;
              break;
            case 'tuesday':
              updateData.priorityTuesday = dayPriority;
              break;
            case 'wednesday':
              updateData.priorityWednesday = dayPriority;
              break;
            case 'thursday':
              updateData.priorityThursday = dayPriority;
              break;
            case 'friday':
              updateData.priorityFriday = dayPriority;
              break;
          }
          updated[existingIndex] = { ...updated[existingIndex], ...updateData };
        } else {
          // Регион новый, создаем новую запись
          const newPriority: RegionPriority = {
            id: regionId,
            region,
            priority: 0,
            priorityMonday: null,
            priorityTuesday: null,
            priorityWednesday: null,
            priorityThursday: null,
            priorityFriday: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          
          // Устанавливаем приоритет для выбранного дня
          switch (day) {
            case 'monday':
              newPriority.priorityMonday = dayPriority;
              break;
            case 'tuesday':
              newPriority.priorityTuesday = dayPriority;
              break;
            case 'wednesday':
              newPriority.priorityWednesday = dayPriority;
              break;
            case 'thursday':
              newPriority.priorityThursday = dayPriority;
              break;
            case 'friday':
              newPriority.priorityFriday = dayPriority;
              break;
          }
          
          updated.push(newPriority);
        }

        return updated;
      });

      setHasChanges(true);
      setShowAddModal(false);
      setSelectedRegionToAdd(null);
      setSuccess(`Регион "${region}" добавлен в ${DAYS_OF_WEEK.find(d => d.key === day)?.label}`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при добавлении региона:', error);
      setError('Ошибка при добавлении региона');
    }
  };

  const handleRemoveRegion = async (id: string, day: DayOfWeek) => {
    try {
      // Удаляем регион только из выбранного дня
      setPriorities((prev) => {
        return prev.map((p) => {
          if (p.id === id) {
            const updateData: Partial<RegionPriority> = {};
            switch (day) {
              case 'monday':
                updateData.priorityMonday = null;
                break;
              case 'tuesday':
                updateData.priorityTuesday = null;
                break;
              case 'wednesday':
                updateData.priorityWednesday = null;
                break;
              case 'thursday':
                updateData.priorityThursday = null;
                break;
              case 'friday':
                updateData.priorityFriday = null;
                break;
            }
            return { ...p, ...updateData };
          }
          return p;
        });
      });

      setHasChanges(true);
      setSuccess('Регион удален из дня недели');
      setTimeout(() => setSuccess(''), 3000);
    } catch (error) {
      console.error('Ошибка при удалении региона:', error);
      setError('Ошибка при удалении региона');
    }
  };

  const copyDayToAllDays = (sourceDay: DayOfWeek) => {
    const sourceRegions = getRegionsForDay(sourceDay);
    setPriorities((prev) => {
      return prev.map((p) => {
        const index = sourceRegions.findIndex((r) => r.id === p.id);
        if (index !== -1) {
          // Регион есть в исходном дне, копируем его позицию на все дни
          return {
            ...p,
            priorityMonday: index,
            priorityTuesday: index,
            priorityWednesday: index,
            priorityThursday: index,
            priorityFriday: index,
          };
        }
        return p;
      });
    });
    setHasChanges(true);
    setSuccess(`Приоритеты ${DAYS_OF_WEEK.find(d => d.key === sourceDay)?.label} скопированы на все дни`);
    setTimeout(() => setSuccess(''), 3000);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка приоритетов регионов...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Заголовок с улучшенным дизайном */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-600 to-purple-500 rounded-xl flex items-center justify-center shadow-lg shadow-purple-500/30">
              <Calendar className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
                Приоритетность регионов
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  className="text-slate-400 hover:text-slate-200 transition-colors"
                  title="Показать информацию"
                >
                  <Info className="w-5 h-5" />
                </button>
              </h2>
              <p className="text-sm text-slate-400">
                Настройте приоритеты регионов по дням недели. Используйте стрелки для изменения порядка.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasChanges && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-500/50 rounded-lg text-yellow-300 text-sm">
                <AlertCircle className="w-4 h-4" />
                Есть несохраненные изменения
              </div>
            )}
            <button
              onClick={loadData}
              className="px-3 py-2 bg-slate-700/90 hover:bg-slate-600 text-slate-200 rounded-lg transition-all flex items-center gap-2 text-sm shadow-md hover:shadow-lg hover:scale-105 active:scale-95"
              title="Обновить список"
            >
              <RefreshCw className="w-4 h-4" />
              Обновить
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
              className="px-4 py-2 bg-blue-600/90 hover:bg-blue-500 text-white rounded-lg transition-all flex items-center gap-2 text-sm shadow-md hover:shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Сохранить
                </>
              )}
            </button>
          </div>
        </div>

        {showInfo && (
          <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 mb-4 animate-fadeIn">
            <div className="flex items-start gap-3">
              <Info className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-slate-300 space-y-2">
                <p><strong className="text-blue-300">Как использовать:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Добавляйте регионы в нужные дни недели через кнопку &quot;+&quot;</li>
                  <li>Используйте стрелки ↑↓ для изменения порядка внутри дня</li>
                  <li>Каждый день недели полностью независим</li>
                  <li>Используйте кнопку &quot;Копировать&quot; для применения приоритетов одного дня на все дни</li>
                  <li>Регион остается в списке доступных, пока не добавлен во все дни</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-red-500/20 animate-slideDown">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-900/40 border-2 border-green-500/60 text-green-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-green-500/20 animate-slideDown">
          <CheckCircle2 className="w-5 h-5 text-green-400" />
          <span className="font-medium">{success}</span>
        </div>
      )}

      {/* Сетка с 5 столбцами (дни недели) */}
      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-6 shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {DAYS_OF_WEEK.map((day) => {
            const dayRegions = getRegionsForDay(day.key);
            return (
              <DayColumn
                key={day.key}
                day={day}
                regions={dayRegions}
                onMoveUp={(regionId) => moveRegionUp(day.key, regionId)}
                onMoveDown={(regionId) => moveRegionDown(day.key, regionId)}
                onRemove={(regionId) => handleRemoveRegion(regionId, day.key)}
                onCopy={copyDayToAllDays}
              />
            );
          })}
        </div>
      </div>

      {/* Список доступных регионов */}
      {getAvailableRegions().length > 0 && (
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-slate-100 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            Доступные регионы
          </h3>
          <p className="text-sm text-slate-400 mb-4">
            Выберите регион и день недели для добавления. Регион останется в списке, пока не будет добавлен во все дни.
          </p>
          <div className="flex flex-wrap gap-2">
            {getAvailableRegions().map((region) => (
              <button
                key={region}
                onClick={() => handleAddRegionClick(region)}
                className="px-4 py-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 rounded-lg border border-purple-500/50 transition-all flex items-center gap-2 text-sm hover:scale-105 active:scale-95 shadow-md hover:shadow-lg group"
              >
                <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
                {region}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Модальное окно выбора дня недели */}
      {showAddModal && selectedRegionToAdd && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-lg shadow-2xl max-w-md w-full border border-slate-700">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h2 className="text-xl font-bold text-slate-100">Выберите день недели</h2>
                <p className="text-sm text-slate-400 mt-1">
                  Добавить регион &quot;{selectedRegionToAdd}&quot; в:
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setSelectedRegionToAdd(null);
                }}
                className="text-slate-400 hover:text-slate-100 transition-colors"
              >
                <XIcon className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 gap-3">
                {DAYS_OF_WEEK.map((day) => {
                  const dayRegions = getRegionsForDay(day.key);
                  const isAlreadyAdded = dayRegions.some((r) => r.region === selectedRegionToAdd);
                  
                  return (
                    <button
                      key={day.key}
                      onClick={() => {
                        if (!isAlreadyAdded) {
                          handleAddRegion(selectedRegionToAdd, day.key);
                        }
                      }}
                      disabled={isAlreadyAdded}
                      className={`p-4 rounded-lg border-2 transition-all text-left ${
                        isAlreadyAdded
                          ? 'border-slate-700 bg-slate-700/30 text-slate-500 cursor-not-allowed'
                          : `bg-gradient-to-r ${day.color} border-transparent text-white hover:scale-105 active:scale-95 shadow-md hover:shadow-lg`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold text-lg">{day.label}</div>
                          <div className="text-sm opacity-80">
                            {isAlreadyAdded ? 'Уже добавлен' : `${dayRegions.length} регионов`}
                          </div>
                        </div>
                        {isAlreadyAdded && (
                          <CheckCircle2 className="w-5 h-5" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface DayColumnProps {
  day: typeof DAYS_OF_WEEK[0];
  regions: RegionPriority[];
  onMoveUp: (regionId: string) => void;
  onMoveDown: (regionId: string) => void;
  onRemove: (regionId: string) => void;
  onCopy: (day: DayOfWeek) => void;
}

function DayColumn({ day, regions, onMoveUp, onMoveDown, onRemove, onCopy }: DayColumnProps) {
  return (
    <div className="bg-slate-900/50 rounded-lg border-2 border-slate-700/50 p-4 min-h-[400px] flex flex-col">
      {/* Заголовок столбца */}
      <div className={`bg-gradient-to-r ${day.color} rounded-lg p-3 mb-3 shadow-lg`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white font-bold text-lg">{day.short}</div>
            <div className="text-white/80 text-xs">{day.label}</div>
          </div>
          <button
            onClick={() => onCopy(day.key)}
            className="p-1.5 bg-white/20 hover:bg-white/30 rounded transition-all hover:scale-110 active:scale-95"
            title={`Скопировать приоритеты ${day.label} на все дни`}
          >
            <Copy className="w-4 h-4 text-white" />
          </button>
        </div>
        <div className="mt-2 text-white/70 text-xs flex items-center gap-1">
          <MapPin className="w-3 h-3" />
          {regions.length} регионов
        </div>
      </div>

      {/* Список регионов */}
      <div className="flex-1 space-y-2 overflow-y-auto max-h-[500px] pr-1">
        {regions.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>Нет регионов</p>
          </div>
        ) : (
          regions.map((region, index) => (
            <RegionItem
              key={`${day.key}-${region.id}`}
              region={region}
              day={day.key}
              index={index}
              total={regions.length}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface RegionItemProps {
  region: RegionPriority;
  day: DayOfWeek;
  index: number;
  total: number;
  onMoveUp: (regionId: string) => void;
  onMoveDown: (regionId: string) => void;
  onRemove: (regionId: string) => void;
}

function RegionItem({ region, day, index, total, onMoveUp, onMoveDown, onRemove }: RegionItemProps) {
  return (
    <div className="bg-slate-800/70 border-2 border-slate-600/50 rounded-lg p-3 flex items-center gap-2 hover:border-purple-500/50 transition-all group shadow-md hover:shadow-lg">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="w-6 h-6 bg-purple-600/20 text-purple-300 rounded-full flex items-center justify-center font-bold text-xs border border-purple-500/50 flex-shrink-0">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-slate-200 font-semibold text-sm truncate">{region.region}</div>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={() => onMoveUp(region.id)}
          disabled={index === 0}
          className="p-1.5 bg-slate-700/50 hover:bg-slate-600 text-slate-300 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
          title="Переместить вверх"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onMoveDown(region.id)}
          disabled={index === total - 1}
          className="p-1.5 bg-slate-700/50 hover:bg-slate-600 text-slate-300 rounded transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:scale-110 active:scale-95"
          title="Переместить вниз"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
        <button
          onClick={() => onRemove(region.id)}
          className="p-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 rounded transition-all hover:scale-110 active:scale-95 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Удалить из дня"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
