'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/Modal';

interface User {
  id: string;
  name: string;
  login: string;
  role: string;
}

interface DictatorSelectModalProps {
  isOpen: boolean;
  onSelect: (dictatorId: string | null) => void;
  onCancel: () => void;
}

export function DictatorSelectModal({ isOpen, onSelect, onCancel }: DictatorSelectModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDictatorId, setSelectedDictatorId] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      loadUsers();
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/users');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Ошибка при загрузке пользователей:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    onSelect(selectedDictatorId || null);
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Выберите диктовщика">
      <div className="space-y-4">
        <p className="text-slate-300 text-sm">
          Выберите диктовщика, с которым вы будете делить баллы за проверку. Диктовщик получит 0.75 от ваших баллов.
        </p>
        
        {isLoading ? (
          <div className="text-center py-8 text-slate-400">Загрузка пользователей...</div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            <label className="block">
              <input
                type="radio"
                name="dictator"
                value=""
                checked={selectedDictatorId === ''}
                onChange={(e) => setSelectedDictatorId(e.target.value)}
                className="mr-2"
              />
              <span className="text-slate-300">Без диктовщика</span>
            </label>
            {users.map((user) => (
              <label key={user.id} className="block">
                <input
                  type="radio"
                  name="dictator"
                  value={user.id}
                  checked={selectedDictatorId === user.id}
                  onChange={(e) => setSelectedDictatorId(e.target.value)}
                  className="mr-2"
                />
                <span className="text-slate-300">{user.name} ({user.login})</span>
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4 border-t border-slate-700">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </Modal>
  );
}
