const CACHE_NAME = 'smart-reader-v4'; // Меняйте версию при обновлениях

const urlsToCache = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/tts.js',
  './js/api.js',
  './js/db.js',
  './js/parser.js',
  './manifest.json',
  './icon.png' 
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Не кэшируем запросы к API Google и Словарям, чтобы не было ошибок CORS/Opaque
  if (event.request.url.includes('translate') || 
      event.request.url.includes('dictionaryapi') || 
      event.request.url.includes('chrome-extension')) {
      return; 
  }

  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});