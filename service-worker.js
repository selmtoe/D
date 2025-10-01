const CACHE_NAME = 'daifugo-v1';
// キャッシュするファイルのリスト
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
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

// fetchイベント：リクエストに応答する
// キャッシュがあればキャッシュから、なければネットワークから取得
self.addEventListener('fetch', (event) => {
  // Firebaseなど外部へのリクエストはキャッシュしない
  if (event.request.url.startsWith('https://')) {
    return;
  }
  
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});
