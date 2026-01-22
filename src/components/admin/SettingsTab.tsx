'use client';

import { useState, useEffect } from 'react';
import { Settings, Save, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/useToast';

export default function SettingsTab() {
  const [collectorSeesOnlyFirstOrder, setCollectorSeesOnlyFirstOrder] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const { showToast, showError, showSuccess } = useToast();

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/settings');
      if (!response.ok) {
        throw new Error('Ошибка при загрузке настроек');
      }
      const data = await response.json();
      if (data.success && data.settings) {
        setCollectorSeesOnlyFirstOrder(
          data.settings.collector_sees_only_first_order === true
        );
      }
    } catch (error) {
      console.error('[SettingsTab] Ошибка при загрузке настроек:', error);
      showError('Не удалось загрузить настройки');
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    try {
      setIsSaving(true);
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          key: 'collector_sees_only_first_order',
          value: collectorSeesOnlyFirstOrder,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Ошибка при сохранении настроек');
      }

      showSuccess('Настройки успешно сохранены');
    } catch (error: any) {
      console.error('[SettingsTab] Ошибка при сохранении настроек:', error);
      showError(error.message || 'Не удалось сохранить настройки');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка настроек...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg">
          <Settings className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Настройки системы</h2>
          <p className="text-sm text-slate-400">Управление системными параметрами</p>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-700/50 rounded-lg p-6 space-y-6">
        {/* Настройка для сборщиков */}
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-100 mb-2">
                Режим работы сборщиков
              </h3>
              <p className="text-sm text-slate-400 mb-4">
                При включении этой настройки сборщики будут видеть только первый доступный заказ в списке.
                Остальные заказы будут скрыты до завершения текущего.
              </p>
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={collectorSeesOnlyFirstOrder}
                  onChange={(e) => setCollectorSeesOnlyFirstOrder(e.target.checked)}
                  className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 cursor-pointer transition-all"
                />
                <span className="text-base font-medium text-slate-200 group-hover:text-slate-100 transition-colors">
                  Сборщик видит только первый заказ
                </span>
              </label>
              <p className="text-xs text-slate-500 mt-2 ml-8">
                {collectorSeesOnlyFirstOrder
                  ? 'Включено: сборщики видят только первый доступный заказ'
                  : 'Выключено: сборщики видят все доступные заказы'}
              </p>
            </div>
          </div>
        </div>

        {/* Кнопка сохранения */}
        <div className="pt-4 border-t border-slate-700/50">
          <button
            onClick={saveSettings}
            disabled={isSaving}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:from-slate-600 disabled:to-slate-500 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 disabled:hover:scale-100 flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Сохранение...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                <span>Сохранить настройки</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
