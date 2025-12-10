'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';

interface SendToOfficeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comment: string, places: number) => void;
  shipmentNumber: string;
}

export function SendToOfficeModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  shipmentNumber 
}: SendToOfficeModalProps) {
  const [comment, setComment] = useState('');
  const [places, setPlaces] = useState<number | ''>(1);
  const [errors, setErrors] = useState<{ comment?: string; places?: string }>({});

  // Сбрасываем форму при открытии/закрытии
  useEffect(() => {
    if (isOpen) {
      setComment('');
      setPlaces(1);
      setErrors({});
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Валидация
    const newErrors: { comment?: string; places?: string } = {};
    
    if (places === '' || places < 1) {
      newErrors.places = 'Количество мест должно быть не менее 1';
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    // Вызываем callback с данными
    onConfirm(comment.trim(), Number(places));
  };

  const handlePlacesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '') {
      setPlaces('');
    } else {
      const num = parseInt(value, 10);
      if (!isNaN(num) && num > 0) {
        setPlaces(num);
      }
    }
    // Очищаем ошибку при изменении
    if (errors.places) {
      setErrors(prev => ({ ...prev, places: undefined }));
    }
  };

  if (!isOpen) return null;

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
            Все задания подтверждены. Перед отправкой заказа в офис укажите дополнительную информацию:
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="places" className="block text-sm font-medium text-slate-300 mb-2">
              Количество мест <span className="text-red-400">*</span>
            </label>
            <input
              id="places"
              type="number"
              min="1"
              value={places}
              onChange={handlePlacesChange}
              className={`w-full px-4 py-2 bg-slate-700 border rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                errors.places ? 'border-red-500' : 'border-slate-600'
              }`}
              placeholder="Введите количество мест"
              required
            />
            {errors.places && (
              <p className="mt-1 text-sm text-red-400">{errors.places}</p>
            )}
          </div>

          <div>
            <label htmlFor="comment" className="block text-sm font-medium text-slate-300 mb-2">
              Комментарий
            </label>
            <textarea
              id="comment"
              value={comment}
              onChange={(e) => {
                setComment(e.target.value);
                if (errors.comment) {
                  setErrors(prev => ({ ...prev, comment: undefined }));
                }
              }}
              rows={4}
              className={`w-full px-4 py-2 bg-slate-700 border rounded-lg text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                errors.comment ? 'border-red-500' : 'border-slate-600'
              }`}
              placeholder="Введите комментарий (необязательно)"
            />
            {errors.comment && (
              <p className="mt-1 text-sm text-red-400">{errors.comment}</p>
            )}
          </div>
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
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Отправить в офис
          </button>
        </div>
      </form>
    </Modal>
  );
}

