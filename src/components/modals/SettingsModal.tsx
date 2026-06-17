'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Modal } from '@/components/ui/Modal';
import { ProfilePhotoAvatar } from '@/components/ui/ProfilePhotoAvatar';
import { useUserSettings } from '@/contexts/UserSettingsContext';
import type { UserCollectSettings, CollectConfirmMode } from '@/types';
import { Camera, Trash2, X } from 'lucide-react';

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  userRole?: string | null;
  userName?: string | null;
}

const MODE_LABELS: Record<CollectConfirmMode, string> = {
  'swipe': 'Свайп',
  'double-click': 'Двойной клик',
};

export function SettingsModal({ isOpen, onClose, userRole, userName }: SettingsModalProps) {
  const { settings, updateSettings, setProfilePhotoUrl } = useUserSettings();
  const [showDeletePhoto, setShowDeletePhoto] = useState(false);
  const [randomPhotoUrl, setRandomPhotoUrl] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleProfilePhotoSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setPhotoError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Разрешены только JPG, PNG или WebP');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError('Файл больше 3 МБ');
      return;
    }

    setPhotoUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/users/me/profile-photo', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoError(typeof data.error === 'string' ? data.error : 'Не удалось загрузить фото');
        return;
      }
      setProfilePhotoUrl(typeof data.profilePhotoUrl === 'string' ? data.profilePhotoUrl : null);
    } catch {
      setPhotoError('Не удалось загрузить фото');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleProfilePhotoDelete = async () => {
    setPhotoError(null);
    setPhotoUploading(true);
    try {
      const res = await fetch('/api/users/me/profile-photo', {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPhotoError(typeof data.error === 'string' ? data.error : 'Не удалось удалить фото');
        return;
      }
      setProfilePhotoUrl(null);
    } catch {
      setPhotoError('Не удалось удалить фото');
    } finally {
      setPhotoUploading(false);
    }
  };

  const isCheckerRole = userRole === 'checker' || userRole === 'warehouse_3' || userRole === 'admin';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Настройки">
      <div className="space-y-6">
        <div className="border-b border-slate-700/50 pb-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Фото профиля</h3>
          <p className="text-xs text-slate-400 mb-3">
            JPG, PNG или WebP до 3 МБ. Фото показывается в общем топе рядом с вашим именем.
          </p>
          <div className="flex items-center gap-4">
            <ProfilePhotoAvatar
              url={settings.profilePhotoUrl}
              name={userName ?? 'Профиль'}
              className="w-16 h-16 ring-2 ring-slate-600"
              fallback={
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-xl font-bold ring-2 ring-slate-600">
                  {(userName ?? '?').trim().charAt(0).toUpperCase()}
                </div>
              }
            />
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleProfilePhotoSelect}
              />
              <button
                type="button"
                disabled={photoUploading}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-700/80 hover:bg-slate-600/80 text-slate-200 disabled:opacity-60"
              >
                <Camera className="w-4 h-4" />
                {photoUploading ? 'Загрузка...' : settings.profilePhotoUrl ? 'Заменить фото' : 'Выбрать фото'}
              </button>
              {settings.profilePhotoUrl && (
                <button
                  type="button"
                  disabled={photoUploading}
                  onClick={handleProfilePhotoDelete}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-800 hover:bg-red-900/40 text-slate-400 hover:text-red-200 disabled:opacity-60"
                >
                  <Trash2 className="w-4 h-4" />
                  Удалить фото
                </button>
              )}
            </div>
          </div>
          {photoError && <p className="text-xs text-red-400 mt-2">{photoError}</p>}
        </div>

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

        {isCheckerRole && (
        <div className="border-t border-slate-700/50 pt-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Подтверждение при проверке</h3>
          <p className="text-xs text-slate-400 mb-3">
            Как подтверждать позицию при проверке заказа: свайпом или двойным кликом. Доступно в обычном и компактном режиме.
          </p>
          <div className="flex gap-2">
            {(['swipe', 'double-click'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => updateSettings({ confirmPositionConfirm: mode })}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  (settings.confirmPositionConfirm ?? 'swipe') === mode
                    ? 'bg-green-600/90 text-white'
                    : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
                }`}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>
        )}

        {userRole === 'admin' && (
        <div className="border-t border-slate-700/50 pt-4">
          <h3 className="text-sm font-semibold text-slate-200 mb-3">Кнопки администратора</h3>
          <p className="text-xs text-slate-400 mb-3">
            Показывать на карточках заказов кнопки «Собрать всё», «Подтвердить всё» и «Удалить сборку». Перед действием будет запрос подтверждения.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => updateSettings({ adminShowCollectionButtons: true })}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                settings.adminShowCollectionButtons ? 'bg-green-600/90 text-white' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
              }`}
            >
              Включено
            </button>
            <button
              type="button"
              onClick={() => updateSettings({ adminShowCollectionButtons: false })}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                !settings.adminShowCollectionButtons ? 'bg-green-600/90 text-white' : 'bg-slate-700/80 text-slate-300 hover:bg-slate-600/80'
              }`}
            >
              Выключено
            </button>
          </div>
        </div>
        )}

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
