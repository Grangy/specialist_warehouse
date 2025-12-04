'use client';

import { useEffect } from 'react';

export function PWARegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          console.log('Service Worker зарегистрирован:', registration);
          
          // Принудительно обновляем service worker
          registration.update();
          
          // Проверяем обновления каждые 60 секунд
          setInterval(() => {
            registration.update();
          }, 60000);
          
          // Обрабатываем обновления
          registration.addEventListener('updatefound', () => {
            console.log('[SW] Найдено обновление service worker');
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('[SW] Новая версия установлена, перезагружаем страницу');
                  window.location.reload();
                }
              });
            }
          });
        })
        .catch((error) => {
          console.error('Ошибка регистрации Service Worker:', error);
        });
    }
  }, []);

  return null;
}

