const CACHE_NAME = 'daifugo-luxe-v7';
// キャッシュするファイルのリスト
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './styles/daifugo-luxe.css?v=7',
  './src/avatar-studio.js?v=7',
  './assets/luxury-card-salon.png',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png'
];

// installイベント：キャッシュにアセットを追加する
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Pre-caching offline page');
        return cache.addAll(FILES_TO_CACHE);
      })
  );
  self.skipWaiting();
});

// activateイベント：古いキャッシュをクリーンアップする
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(keyList.map((key) => {
        if (key !== CACHE_NAME) {
          console.log('[ServiceWorker] Removing old cache', key);
          return caches.delete(key);
        }
      }));
    })
  );
  self.clients.claim();
});

// fetchイベント：更新を優先し、オフライン時だけキャッシュへフォールバック
self.addEventListener('fetch', (event) => {
  // FirebaseやCDNなど、別オリジンへのリクエストはキャッシュしない
  if (new URL(event.request.url).origin !== self.location.origin) {
    return;
  }
  
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request)
    .then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
      return response;
    })
    .catch(() => caches.match(event.request)));
});
