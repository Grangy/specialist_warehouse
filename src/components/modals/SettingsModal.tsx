'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/Modal';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import type { UserCollectSettings, CollectConfirmMode } from '@/types';
import { X } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODE_LABELS: Record<CollectConfirmMode, string> = {
  'swipe': 'Свайп',
  'double-click': 'Двойной клик',
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useUserSettings();
  const [showDeletePhoto, setShowDeletePhoto] = useState(false);
  const [randomPhotoUrl, setRandomPhotoUrl] = useState<string | null>(null);

  const handleDeleteAccountClick = async () => {
    try {
      const res = await fetch('/api/photo/random');
      const data = await res.json();
      setRandomPhotoUrl(data.url || '/photo/i (3).webp');
    } catch {
      setRandomPhotoUrl('/photo/i (3).webp');
    }
    setShowDeletePhoto(true);
  };

  const handlePositionChange = (value: CollectConfirmMode) => {
    updateSettings({ collectPositionConfirm: value });
  };

  const handleOverallChange = (value: CollectConfirmMode) => {
    updateSettings({ collectOverallConfirm: value });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки сборки">
      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Подтверждение каждой позиции</h3>
          <p className="text-xs text-slate-400 mb-3">
            Как подтверждать сборку одной позиции внутри заказа: свайпом или двойным кликом.
          </p>
          <div className="flex gap-2">
            {(['swipe', 'double-click'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handlePositionChange(mode)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  settings.collectPositionConfirm === mode
                    ? 'bg-green-600/90 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Подтверждение всей сборки</h3>
          <p className="text-xs text-slate-400 mb-3">
            Как подтверждать завершение сборки заказа (кнопка «Сборка»): свайпом или двойным кликом.
          </p>
          <div className="flex gap-2">
            {(['swipe', 'double-click'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => handleOverallChange(mode)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  settings.collectOverallConfirm === mode
                    ? 'bg-green-600/90 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-slate-700/50 pt-4">
          <button
            type="button"
            onClick={handleDeleteAccountClick}
            className="w-full py-2.5 rounded-lg text-sm font-medium bg-slate-700/80 hover:bg-red-600/30 border border-slate-600/50 hover:border-red-500/30 text-slate-300 hover:text-red-200 transition-all"
          >
            Удалить аккаунт
          </button>
        </div>
      </div>

      {/* Оверлей с случайной фоткой при нажатии "Удалить аккаунт" */}
      {showDeletePhoto && randomPhotoUrl && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          onClick={() => {
            setShowDeletePhoto(false);
            setRandomPhotoUrl(null);
          }}
        >
          <button
            type="button"
            onClick={() => {
              setShowDeletePhoto(false);
              setRandomPhotoUrl(null);
            }}
            className="absolute top-4 right-4 p-2 rounded-full bg-slate-700/90 hover:bg-slate-600 text-white transition-colors"
            aria-label="Закрыть"
          >
            <X className="w-6 h-6" />
          </button>
          <div className="relative w-full max-w-4xl h-[90vh] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <Image
              src={randomPhotoUrl}
              alt=""
              fill
              className="object-contain rounded-lg pointer-events-none"
              sizes="(max-width: 1200px) 100vw, 896px"
              unoptimized
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
