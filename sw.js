/* ============================================
   VR Homes — Service Worker
   キャッシュ戦略: Cache First（静的ファイル）
              + Network First（API）
============================================ */
const CACHE_NAME    = 'vr-homes-v19';
const STATIC_ASSETS = [
  './',
  './index.html',
  './site.css',
  './app.js',
  './features.js',
  './mascot.js',
  './theme.css',
  './yk-ai.js',
  './yk-model.json',
  './img/doll.webp',
  './img/measure.webp',
  './img/sun.webp',
  './img/furn.webp',
  './img/live.webp',
  './help.html',
  './privacy.html',
  './terms.html',
  './vr-viewer.html',
  './floor-editor.html',
  'https://cdn.jsdelivr.net/npm/babylonjs@9.29.0/babylon.js',
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.19.0/dist/tabler-icons.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];

/* ── インストール：静的ファイルをキャッシュ ── */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* ── アクティベート：古いキャッシュを削除 ── */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* ── フェッチ戦略 ── */
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // AWS Lambda URL → Network Only（キャッシュしない）
  if (url.hostname.includes('lambda-url') || url.hostname.includes('amazonaws')) {
    return; // ブラウザのデフォルト動作
  }

  // Nominatim（ジオコーディング）→ Network Only
  if (url.hostname.includes('nominatim.openstreetmap.org')) {
    return;
  }

  // 静的ファイル → Cache First
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        // 成功レスポンスのみキャッシュ
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // オフライン時: HTMLリクエストならキャッシュ済みindex.htmlを返す
        if (e.request.destination === 'document') {
          return caches.match('./index.html');
        }
      });
    })
  );
});

/* ── プッシュ通知（将来用） ── */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  self.registration.showNotification(data.title || 'VR Homes', {
    body: data.body || '新着物件のお知らせ',
    icon: './icon-192.png',
    badge: './icon-192.png',
  });
});
