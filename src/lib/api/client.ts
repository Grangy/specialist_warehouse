// API клиент

import { APIError } from '@/types';

class APIClient {
  private baseURL: string;
  private requestQueue: Set<string> = new Set();

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const requestKey = `${options.method || 'GET'}:${url}`;
    
    // Предотвращаем дублирующие запросы только для GET запросов
    // POST/PUT/DELETE могут быть повторными по необходимости
    const isGetRequest = !options.method || options.method === 'GET';
    
    if (isGetRequest && this.requestQueue.has(requestKey)) {
      // Для GET запросов просто пропускаем дубликат
      // Это предотвратит спам, но не заблокирует POST запросы
      return Promise.reject({
        message: 'Request already in progress',
      } as APIError);
    }
    
    // Добавляем в очередь только GET запросы
    if (isGetRequest) {
      this.requestQueue.add(requestKey);
    }
    
    const config: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        let errorData: any = {};
        try {
          // Сначала пытаемся получить текст ответа
          const text = await response.text();
          console.log('[apiClient] Текст ответа об ошибке:', text);
          if (text) {
            try {
              errorData = JSON.parse(text);
              console.log('[apiClient] Распарсенные данные ошибки:', errorData);
            } catch (parseError) {
              // Если не JSON, используем текст как сообщение
              console.warn('[apiClient] Не удалось распарсить JSON, используем текст:', parseError);
              errorData = { message: text };
            }
          }
        } catch (e) {
          // Если не удалось прочитать ответ, используем пустой объект
          console.warn('[apiClient] Не удалось прочитать ответ об ошибке:', e);
        }
        
        // Формируем сообщение об ошибке
        let errorMessage = errorData.message || errorData.error;
        console.log('[apiClient] Извлеченное сообщение об ошибке:', errorMessage);
        
        // Если сообщения нет, формируем стандартное
        if (!errorMessage) {
          if (response.status === 409) {
            errorMessage = 'Задание уже начато другим сборщиком. Только администратор может вмешаться в сборку.';
          } else {
            errorMessage = `HTTP error! status: ${response.status}`;
          }
        }
        
        const error: APIError = {
          message: errorMessage,
          status: response.status,
        };
        console.log('[apiClient] Выбрасываем ошибку:', error);
        throw error;
      }

      return await response.json();
    } catch (error) {
      // Если ошибка уже имеет структуру APIError (с полями message и status), просто пробрасываем её
      if (error && typeof error === 'object' && 'status' in error && 'message' in error) {
        throw error;
      }
      // Если это обычная ошибка Error, оборачиваем её
      if (error instanceof Error) {
        throw {
          message: error.message,
        } as APIError;
      }
      // В остальных случаях - общая ошибка сети
      throw {
        message: 'Network error',
      } as APIError;
    } finally {
      // Удаляем запрос из очереди после завершения (только для GET)
      if (isGetRequest) {
        this.requestQueue.delete(requestKey);
      }
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async put<T>(endpoint: string, data?: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }
}

// Автоматически определяем базовый URL для работы с локальным IP
function getApiBaseUrl(): string {
  // В браузере используем текущий origin + /api
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api`;
  }
  // На сервере используем переменную окружения или дефолт
  return process.env.NEXT_PUBLIC_API_BASE || '/api';
}

// Используем автоматическое определение URL для работы через Next.js API routes
export const apiClient = new APIClient(getApiBaseUrl());

