/* ============================================
   VR Homes — Service Worker
   キャッシュ戦略: サイトのファイルは Network First（いつも最新）
              外部ライブラリは Cache First
============================================ */
const CACHE_NAME    = 'vr-homes-v41';
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
  './icon-192.png',
  './icon-512.png',
  './manifest.json',
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

/* ── インストール：静的ファイルをキャッシュ ──
   ブラウザのHTTPキャッシュに残っている古いファイルを拾わないように、必ずサーバーから取り直す */
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
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

/* ── フェッチ戦略 ──
   ・このサイトのファイル（HTML・JS・CSS など）→ Network First：いつも最新を取りに行き、オフラインのときだけキャッシュ
     （更新したのに古い画面が出る、を防ぐ）
   ・外部のライブラリ（バージョン固定のCDN）→ Cache First */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // AWS（Lambda・S3）と地図の検索 → キャッシュしない
  if (url.hostname.includes('lambda-url') || url.hostname.includes('amazonaws') || url.hostname.includes('nominatim.openstreetmap.org')) return;

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request, { cache: 'no-cache' }).then(res => {
        if (res && res.status === 200) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('./index.html');
      }))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
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
