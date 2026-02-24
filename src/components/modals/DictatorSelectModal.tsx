'use client';

import { useState, useEffect, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';

const DICTATOR_REQUIRED_SOUND_URL = '/music/20031.mp3';

interface User {
  id: string;
  name: string;
  login: string;
  role: string;
}

interface DictatorSelectModalProps {
  isOpen: boolean;
  onSelect: (dictatorId: string, dictatorName: string) => void;
  onCancel: () => void;
  /** Для warehouse_3 можно выбрать себя */
  userRole?: string;
  /** Принудительный выбор (при проверке без диктовщика) */
  required?: boolean;
}

export function DictatorSelectModal({ isOpen, onSelect, onCancel, userRole, required }: DictatorSelectModalProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDictatorId, setSelectedDictatorId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const isWarehouse3 = userRole === 'warehouse_3';
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadCurrentUser();
      loadUsers();
      setSearchQuery(''); // Сбрасываем поиск при открытии
      setSelectedDictatorId(''); // Сбрасываем выбор при открытии
      // Звук при попытке начать проверку без диктовщика
      if (required) {
        const audio = new Audio(DICTATOR_REQUIRED_SOUND_URL);
        audio.volume = 0.8;
        audio.play().catch(() => {});
        audioRef.current = audio;
      }
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current = null;
      }
    };
  }, [isOpen, required]);

  const loadCurrentUser = async () => {
    try {
      const response = await fetch('/api/auth/session');
      if (response.ok) {
        const data = await response.json();
        if (data.user) {
          setCurrentUser(data.user);
        }
      }
    } catch (error) {
      console.error('Ошибка при загрузке текущего пользователя:', error);
    }
  };

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      // Пробуем сначала /api/users/list, если не работает - используем /api/users
      let response = await fetch('/api/users/list');
      let data;
      
      if (response.ok) {
        data = await response.json();
        setUsers(data.users || []);
      } else {
        // Fallback на /api/users
        response = await fetch('/api/users');
        if (response.ok) {
          data = await response.json();
          // /api/users возвращает массив напрямую, а /api/users/list - объект с users
          setUsers(Array.isArray(data) ? data : data.users || []);
        } else {
          console.error('Ошибка при загрузке пользователей:', response.status, response.statusText);
        }
      }
    } catch (error) {
      console.error('Ошибка при загрузке пользователей:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (!selectedDictatorId) return;
    const user = users.find((u) => u.id === selectedDictatorId);
    if (user) onSelect(selectedDictatorId, user.name);
  };

  // Фильтруем пользователей: теперь проверяльщики могут выбирать других проверяльщиков
  const filteredUsers = users.filter((user) => {
    // Фильтруем по поисковому запросу
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.login.toLowerCase().includes(query)
    );
  });

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={required ? 'Кто диктовщик?' : 'Выберите диктовщика'}>
      <div className="space-y-4">
        <p className="text-slate-300 text-sm">
          {required
            ? 'При проверке необходимо указать диктовщика. Выберите диктовщика, с которым вы будете делить баллы (можно себя).'
            : 'Выберите диктовщика, с которым вы будете делить баллы за проверку. Диктовщик получит 0.75 от ваших баллов.'}
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
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-slate-500">
                  {searchQuery ? 'Пользователи не найдены' : 'Нет пользователей'}
                </div>
              ) : (
                filteredUsers.map((user) => {
                  const isSelf = currentUser && user.id === currentUser.id;
                  return (
                  <label key={user.id} className="block p-2 hover:bg-slate-800 rounded-lg cursor-pointer">
                    <input
                      type="radio"
                      name="dictator"
                      value={user.id}
                      checked={selectedDictatorId === user.id}
                      onChange={() => setSelectedDictatorId(user.id)}
                      className="mr-2"
                    />
                    <span className="text-slate-300">
                      {(isWarehouse3 || required) && isSelf ? (
                        <>
                          <span className="text-amber-400 font-medium">{user.name}</span>
                          <span className="text-amber-400/80 text-xs ml-2">(я — диктовщик сам себе)</span>
                        </>
                      ) : (
                        <>
                      {user.name} ({user.login})
                      {user.role && (
                        <span className="text-slate-500 text-xs ml-2">
                          [{user.role === 'admin' ? 'Админ' : user.role === 'collector' ? 'Сборщик' : user.role === 'warehouse_3' ? 'Склад 3' : 'Проверяющий'}]
                        </span>
                      )}
                        </>
                      )}
                    </span>
                  </label>
                );
                })
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
            disabled={!selectedDictatorId}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors disabled:opacity-50"
          >
            Подтвердить
          </button>
        </div>
      </div>
    </Modal>
  );
}
