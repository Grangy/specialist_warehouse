'use client';

import { useState, useEffect, useCallback } from 'react';
import { UserPlus, X } from 'lucide-react';

interface User {
  id: string;
  name: string;
  login: string;
  role: string;
}

interface DictatorSelectorProps {
  userId: string;
}

export function DictatorSelector({ userId }: DictatorSelectorProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDictatorId, setSelectedDictatorId] = useState<string | null>(null);
  const [selectedDictatorName, setSelectedDictatorName] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentUser, setCurrentUser] = useState<User | null>(null);

  const loadSavedDictator = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const storageKey = `dictator_${userId}_${today}`;
      const saved = localStorage.getItem(storageKey);
      
      if (saved) {
        const data = JSON.parse(saved);
        setSelectedDictatorId(data.id);
        setSelectedDictatorName(data.name);
      } else {
        setSelectedDictatorId(null);
        setSelectedDictatorName(null);
      }
    } catch (error) {
      console.error('Ошибка при загрузке сохраненного диктовщика:', error);
    }
  }, [userId]);

  // Загружаем сохраненного диктовщика на день
  useEffect(() => {
    loadSavedDictator();
  }, [loadSavedDictator]);

  // Загружаем текущего пользователя
  useEffect(() => {
    loadCurrentUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Загружаем список пользователей при открытии выбора
  useEffect(() => {
    if (isSelecting) {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSelecting]);

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
      let response = await fetch('/api/users/list');
      let data;
      
      if (response.ok) {
        data = await response.json();
        setUsers(data.users || []);
      } else {
        response = await fetch('/api/users');
        if (response.ok) {
          data = await response.json();
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

  const handleSelect = (dictatorId: string | null, dictatorName: string | null) => {
    if (typeof window === 'undefined') return;
    
    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const storageKey = `dictator_${userId}_${today}`;
      
      if (dictatorId && dictatorName) {
        localStorage.setItem(storageKey, JSON.stringify({ id: dictatorId, name: dictatorName }));
        setSelectedDictatorId(dictatorId);
        setSelectedDictatorName(dictatorName);
      } else {
        localStorage.removeItem(storageKey);
        setSelectedDictatorId(null);
        setSelectedDictatorName(null);
      }
      
      setIsSelecting(false);
      setSearchQuery('');
    } catch (error) {
      console.error('Ошибка при сохранении диктовщика:', error);
    }
  };

  const handleRemove = () => {
    handleSelect(null, null);
  };

  // Фильтруем пользователей: исключаем проверяльщиков, если текущий пользователь - проверяльщик
  const filteredUsers = users.filter((user) => {
    // Если текущий пользователь - проверяльщик, исключаем всех других проверяльщиков
    if (currentUser?.role === 'checker' && user.role === 'checker') {
      return false;
    }
    
    // Фильтруем по поисковому запросу
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      user.name.toLowerCase().includes(query) ||
      user.login.toLowerCase().includes(query)
    );
  });

  return (
    <div className="bg-slate-900/80 rounded-lg p-3 border border-slate-700/50">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
          <UserPlus className="w-4 h-4 text-purple-400" />
        </div>
        <span className="text-sm font-bold text-slate-200">Диктовщик на день</span>
      </div>

      {!isSelecting ? (
        <div className="space-y-2">
          {selectedDictatorId && selectedDictatorName ? (
            <div className="flex items-center justify-between bg-slate-800/50 rounded-lg p-2 border border-slate-700/50">
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400 mb-1">Выбранный диктовщик:</div>
                <div className="text-sm font-semibold text-slate-200 truncate">
                  {selectedDictatorName}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  Получает 0.75 от ваших баллов
                </div>
              </div>
              <button
                onClick={handleRemove}
                className="ml-2 w-8 h-8 flex items-center justify-center rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200 transition-colors flex-shrink-0"
                title="Убрать диктовщика"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="text-center py-2">
              <div className="text-slate-500 text-xs mb-2">Диктовщик не выбран</div>
            </div>
          )}
          <button
            onClick={() => setIsSelecting(true)}
            className="w-full px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-purple-400 text-sm font-medium transition-colors"
          >
            {selectedDictatorId ? 'Изменить диктовщика' : 'Выбрать диктовщика'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Выберите диктовщика, с которым вы будете делить баллы за проверку. Диктовщик получит 0.75 от ваших баллов.
          </p>
          
          {/* Поле поиска */}
          <div className="relative">
            <input
              type="text"
              placeholder="Поиск по имени или логину..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm"
              autoFocus
            />
          </div>

          {isLoading ? (
            <div className="text-center py-4 text-slate-500 text-xs">Загрузка пользователей...</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              <label className="block p-2 hover:bg-slate-800 rounded-lg cursor-pointer">
                <input
                  type="radio"
                  name="dictator"
                  value=""
                  checked={selectedDictatorId === null}
                  onChange={() => handleSelect(null, null)}
                  className="mr-2"
                />
                <span className="text-slate-300 text-sm">Без диктовщика</span>
              </label>
              {filteredUsers.length === 0 ? (
                <div className="text-center py-4 text-slate-500 text-xs">
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
                      onChange={() => handleSelect(user.id, user.name)}
                      className="mr-2"
                    />
                    <span className="text-slate-300 text-sm">
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
          )}

          <button
            onClick={() => setIsSelecting(false)}
            className="w-full px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-sm transition-colors"
          >
            Отмена
          </button>
        </div>
      )}
    </div>
  );
}
