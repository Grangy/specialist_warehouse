// Простой сервис-воркер для PWA
// ВЕРСИЯ 3 - Полностью отключена обработка POST запросов
const CACHE_NAME = 'sklad-shipments-v3';
const urlsToCache = [
  '/',
  '/login',
  '/admin',
  '/manifest.json',
];

// Установка сервис-воркера - ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ
self.addEventListener('install', (event) => {
  console.log('[SW] Установка новой версии service worker');
  // Принудительно активируем новую версию
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Активация сервис-воркера - ПРИНУДИТЕЛЬНОЕ ОБНОВЛЕНИЕ
self.addEventListener('activate', (event) => {
  console.log('[SW] Активация новой версии service worker');
  // Принудительно берем контроль над всеми страницами
  event.waitUntil(
    Promise.all([
      // Удаляем старые кэши
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Удаляем старый кэш:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Берем контроль над всеми страницами
      self.clients.claim()
    ])
  );
});

// Перехват запросов - ПОЛНОСТЬЮ ИГНОРИРУЕМ POST/PUT/DELETE
self.addEventListener('fetch', (event) => {
  // КРИТИЧНО: Полностью игнорируем все не-GET запросы
  // НЕ вызываем event.respondWith для POST/PUT/DELETE/PATCH
  if (event.request.method !== 'GET') {
    // ВООБЩЕ НЕ ОБРАБАТЫВАЕМ - браузер сам обработает
    return;
  }

  // Пропускаем chrome-extension и другие не-HTTP(S) схемы
  try {
    const url = new URL(event.request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return;
    }

    // Пропускаем запросы к API (не кэшируем динамические данные)
    if (url.pathname.startsWith('/api/')) {
      return;
    }
  } catch (e) {
    return;
  }

  // Обрабатываем ТОЛЬКО GET запросы к статическим ресурсам
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кэшируем только успешные GET ответы
        if (response.status === 200 && response.type === 'basic' && response.ok) {
          // Кэшируем асинхронно, не блокируя ответ
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache).catch(() => {
              // Игнорируем ошибки кэширования
            });
          }).catch(() => {
            // Игнорируем ошибки открытия кэша
          });
        }
        return response;
      })
      .catch(() => {
        // Если сеть недоступна, используем кэш
        return caches.match(event.request);
      })
  );
});
