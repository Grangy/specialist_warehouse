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
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      loadUsers();
      setSearchQuery(''); // Сбрасываем поиск при открытии
      setSelectedDictatorId(''); // Сбрасываем выбор при открытии
    }
  }, [isOpen]);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/users/list');
      if (response.ok) {
        const data = await response.json();
        setUsers(data.users || []);
      } else {
        console.error('Ошибка при загрузке пользователей:', response.status, response.statusText);
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

  // Фильтруем пользователей по поисковому запросу
  const filteredUsers = users.filter((user) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.login.toLowerCase().includes(query)
    );
  });

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
          <>
            {/* Поле поиска */}
            <div className="relative">
              <input
                type="text"
                placeholder="Поиск по имени или логину..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              <label className="block p-2 hover:bg-slate-800 rounded-lg cursor-pointer">
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
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-slate-500">
                  {searchQuery ? 'Пользователи не найдены' : 'Нет пользователей'}
                </div>
              ) : (
                filteredUsers.map((user) => (
                  <label key={user.id} className="block p-2 hover:bg-slate-800 rounded-lg cursor-pointer">
                    <input
                      type="radio"
                      name="dictator"
                      value={user.id}
                      checked={selectedDictatorId === user.id}
                      onChange={(e) => setSelectedDictatorId(e.target.value)}
                      className="mr-2"
                    />
                    <span className="text-slate-300">
                      {user.name} ({user.login})
                      {user.role && (
                        <span className="text-slate-500 text-xs ml-2">
                          [{user.role === 'admin' ? 'Админ' : user.role === 'collector' ? 'Сборщик' : 'Проверяющий'}]
                        </span>
                      )}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
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
