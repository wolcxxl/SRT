// sw.js

// ВАЖНО: При каждом изменении app.js или других файлов, 
// МЕНЯЙТЕ ЭТУ ВЕРСИЮ (например, v1 -> v2)
const CACHE_NAME = 'smart-reader-v1';

// Список файлов, которые нужно закэшировать для офлайна
const urlsToCache = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './tts.js',
  './api.js',
  './db.js',
  './parser.js',
  './manifest.json',
  './icon.png'  // <--- ДОБАВИТЬ ЭТУ СТРОКУ
];

// 1. Установка: кэшируем статику
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
  // Заставляет новый SW активироваться немедленно
  self.skipWaiting(); 
});

// 2. Активация: удаляем старые кэши (если версия изменилась)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Заставляет SW немедленно начать контролировать страницу
  return self.clients.claim(); 
});

// 3. Перехват запросов (Стратегия: Cache First, falling back to Network)
self.addEventListener('fetch', (event) => {
  // Игнорируем запросы к API (перевод, google tts), они не должны кэшироваться SW
  if (event.request.url.includes('translate.googleapis.com') || 
      event.request.url.includes('dictionaryapi.dev') ||
      event.request.url.includes('google.com/translate_tts')) {
    return; // Просто идем в сеть
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Если нашли в кэше — возвращаем
        if (response) {
          return response;
        }
        // Если нет — идем в сеть
        return fetch(event.request).catch(() => {
            // Если и сети нет — можно вернуть заглушку (опционально)
            // return caches.match('./offline.html');
        });
      })
  );
});