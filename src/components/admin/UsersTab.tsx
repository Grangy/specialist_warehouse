'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  UserPlus, 
  Edit, 
  Trash2, 
  Save, 
  X, 
  Shield, 
  User, 
  CheckCircle,
  Calendar,
  Loader2,
  AlertCircle,
  Trophy,
  TrendingUp
} from 'lucide-react';

interface AnimalLevel {
  name: string;
  emoji: string;
  color: string;
}

interface User {
  id: string;
  login: string;
  name: string;
  role: 'admin' | 'collector' | 'checker';
  createdAt: string;
  updatedAt: string;
  dailyRank?: number | null;
  dailyLevel?: AnimalLevel | null;
  dailyPoints?: number | null;
  monthlyRank?: number | null;
  monthlyLevel?: AnimalLevel | null;
  monthlyPoints?: number | null;
}

export default function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const router = useRouter();

  const [formData, setFormData] = useState({
    login: '',
    password: '',
    name: '',
    role: 'collector' as 'admin' | 'collector' | 'checker',
  });

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/users');
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          router.push('/login');
          return;
        }
        throw new Error('Ошибка загрузки пользователей');
      }
      const data = await res.json();
      setUsers(data);
    } catch (error) {
      setError('Ошибка загрузки пользователей');
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      if (editingUser) {
        // Обновление пользователя
        const res = await fetch(`/api/users/${editingUser.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Ошибка обновления');
        }
      } else {
        // Создание пользователя
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Ошибка создания');
        }
      }

      setFormData({ login: '', password: '', name: '', role: 'collector' });
      setShowAddForm(false);
      setEditingUser(null);
      loadUsers();
    } catch (error: any) {
      setError(error.message || 'Ошибка операции');
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      login: user.login,
      password: '',
      name: user.name,
      role: user.role,
    });
    setShowAddForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить этого пользователя?')) {
      return;
    }

    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Ошибка удаления');
      }

      loadUsers();
    } catch (error: any) {
      setError(error.message || 'Ошибка удаления');
    }
  };

  const roleLabels = {
    admin: 'Администратор',
    collector: 'Сборщик',
    checker: 'Проверка',
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <div className="text-slate-400 font-medium">Загрузка пользователей...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-blue-500 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-100">Управление пользователями</h2>
            <p className="text-sm text-slate-400">Создание и редактирование пользователей системы</p>
          </div>
        </div>
        <button
          onClick={() => {
            setShowAddForm(true);
            setEditingUser(null);
            setFormData({ login: '', password: '', name: '', role: 'collector' });
          }}
          className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-6 py-3 rounded-lg transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 font-semibold"
        >
          <UserPlus className="w-5 h-5" />
          Добавить пользователя
        </button>
      </div>

      {error && (
        <div className="bg-red-900/40 border-2 border-red-500/60 text-red-200 px-4 py-3 rounded-lg mb-4 flex items-center gap-2 shadow-lg shadow-red-500/20 animate-pulse">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {showAddForm && (
        <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl p-6 mb-6 border-2 border-slate-700/50 shadow-xl animate-slideDown">
          <div className="flex items-center gap-3 mb-6">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
              editingUser 
                ? 'bg-gradient-to-br from-blue-600 to-blue-500' 
                : 'bg-gradient-to-br from-green-600 to-green-500'
            } shadow-lg`}>
              {editingUser ? (
                <Edit className="w-5 h-5 text-white" />
              ) : (
                <UserPlus className="w-5 h-5 text-white" />
              )}
            </div>
            <h3 className="text-xl font-semibold text-slate-100">
              {editingUser ? 'Редактировать пользователя' : 'Добавить пользователя'}
            </h3>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Логин
                </label>
                <input
                  type="text"
                  value={formData.login}
                  onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                  className="w-full bg-slate-700/90 border-2 border-slate-600/50 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <User className="w-4 h-4" />
                  Имя
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full bg-slate-700/90 border-2 border-slate-600/50 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Пароль {editingUser && <span className="text-xs text-slate-400">(оставьте пустым, чтобы не менять)</span>}
                </label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full bg-slate-700/90 border-2 border-slate-600/50 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                  required={!editingUser}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  Роль
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full bg-slate-700/90 border-2 border-slate-600/50 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all duration-200"
                >
                  <option value="admin">Администратор</option>
                  <option value="collector">Сборщик</option>
                  <option value="checker">Проверка</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white px-6 py-3 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 font-semibold"
              >
                <Save className="w-5 h-5" />
                {editingUser ? 'Сохранить' : 'Создать'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingUser(null);
                  setFormData({ login: '', password: '', name: '', role: 'collector' });
                }}
                className="px-6 py-3 bg-slate-700/90 hover:bg-slate-600 text-slate-100 rounded-lg transition-all duration-200 flex items-center justify-center gap-2 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 font-semibold"
              >
                <X className="w-5 h-5" />
                Отмена
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-slate-800/90 backdrop-blur-sm rounded-xl border-2 border-slate-700/50 overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-slate-900/95 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Логин</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Имя</th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Роль</th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  <div className="flex items-center justify-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Рейтинг сегодня
                  </div>
                </th>
                <th className="px-4 py-4 text-center text-sm font-semibold text-slate-200 uppercase tracking-wider">
                  <div className="flex items-center justify-center gap-2">
                    <Trophy className="w-4 h-4" />
                    Рейтинг в месяц
                  </div>
                </th>
                <th className="px-4 py-4 text-left text-sm font-semibold text-slate-200 uppercase tracking-wider">Создан</th>
                <th className="px-4 py-4 text-right text-sm font-semibold text-slate-200 uppercase tracking-wider">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {users.map((user, index) => (
                <tr 
                  key={user.id} 
                  className="hover:bg-slate-700/50 transition-all duration-200 animate-fadeIn"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <td className="px-4 py-4 text-slate-200 font-medium">{user.login}</td>
                  <td className="px-4 py-4 text-slate-200">{user.name}</td>
                  <td className="px-4 py-4">
                    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
                      user.role === 'admin' 
                        ? 'bg-purple-600/20 text-purple-300 border border-purple-500/50'
                        : user.role === 'collector'
                        ? 'bg-blue-600/20 text-blue-300 border border-blue-500/50'
                        : 'bg-green-600/20 text-green-300 border border-green-500/50'
                    }`}>
                      {user.role === 'admin' && <Shield className="w-3.5 h-3.5" />}
                      {user.role === 'collector' && <User className="w-3.5 h-3.5" />}
                      {user.role === 'checker' && <CheckCircle className="w-3.5 h-3.5" />}
                      {roleLabels[user.role]}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-center">
                    {user.dailyLevel ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${user.dailyLevel.color} bg-slate-700/50 border border-slate-600/50`}>
                          <span>{user.dailyLevel.emoji}</span>
                          <span>{user.dailyLevel.name}</span>
                        </span>
                        {user.dailyPoints !== null && user.dailyPoints !== undefined && (
                          <span className="text-xs text-slate-400">
                            {Math.round(user.dailyPoints)} баллов
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {user.monthlyLevel ? (
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold ${user.monthlyLevel.color} bg-slate-700/50 border border-slate-600/50`}>
                          <span>{user.monthlyLevel.emoji}</span>
                          <span>{user.monthlyLevel.name}</span>
                        </span>
                        {user.monthlyPoints !== null && user.monthlyPoints !== undefined && (
                          <span className="text-xs text-slate-400">
                            {Math.round(user.monthlyPoints)} баллов
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-sm">—</span>
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-400 text-sm flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    {new Date(user.createdAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-4 py-4 text-right">
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => handleEdit(user)}
                        className="bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white px-4 py-2 rounded-lg text-sm transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 font-medium"
                      >
                        <Edit className="w-4 h-4" />
                        Редактировать
                      </button>
                      <button
                        onClick={() => handleDelete(user.id)}
                        className="bg-gradient-to-r from-red-600 to-red-500 hover:from-red-500 hover:to-red-400 text-white px-4 py-2 rounded-lg text-sm transition-all duration-200 flex items-center gap-2 shadow-md hover:shadow-lg hover:scale-105 active:scale-95 font-medium"
                      >
                        <Trash2 className="w-4 h-4" />
                        Удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

