/* ============================================
   VR Homes 窶・Service Worker
   繧ｭ繝｣繝・す繝･謌ｦ逡･: 繧ｵ繧､繝医・繝輔ぃ繧､繝ｫ縺ｯ Network First・医＞縺､繧よ怙譁ｰ・・
              螟夜Κ繝ｩ繧､繝悶Λ繝ｪ縺ｯ Cache First
============================================ */
const CACHE_NAME    = 'vr-homes-v51';
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

/* 笏笏 繧､繝ｳ繧ｹ繝医・繝ｫ・夐撕逧・ヵ繧｡繧､繝ｫ繧偵く繝｣繝・す繝･ 笏笏
   繝悶Λ繧ｦ繧ｶ縺ｮHTTP繧ｭ繝｣繝・す繝･縺ｫ谿九▲縺ｦ縺・ｋ蜿､縺・ヵ繧｡繧､繝ｫ繧呈鏡繧上↑縺・ｈ縺・↓縲∝ｿ・★繧ｵ繝ｼ繝舌・縺九ｉ蜿悶ｊ逶ｴ縺・*/
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        STATIC_ASSETS.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

/* 笏笏 繧｢繧ｯ繝・ぅ繝吶・繝茨ｼ壼商縺・く繝｣繝・す繝･繧貞炎髯､ 笏笏 */
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/* 笏笏 繝輔ぉ繝・メ謌ｦ逡･ 笏笏
   繝ｻ縺薙・繧ｵ繧､繝医・繝輔ぃ繧､繝ｫ・・TML繝ｻJS繝ｻCSS 縺ｪ縺ｩ・俄・ Network First・壹＞縺､繧よ怙譁ｰ繧貞叙繧翫↓陦後″縲√が繝輔Λ繧､繝ｳ縺ｮ縺ｨ縺阪□縺代く繝｣繝・す繝･
     ・域峩譁ｰ縺励◆縺ｮ縺ｫ蜿､縺・判髱｢縺悟・繧九√ｒ髦ｲ縺撰ｼ・
   繝ｻ螟夜Κ縺ｮ繝ｩ繧､繝悶Λ繝ｪ・医ヰ繝ｼ繧ｸ繝ｧ繝ｳ蝗ｺ螳壹・CDN・俄・ Cache First */
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // AWS・・ambda繝ｻS3・峨→蝨ｰ蝗ｳ縺ｮ讀懃ｴ｢ 竊・繧ｭ繝｣繝・す繝･縺励↑縺・
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

/* 笏笏 繝励ャ繧ｷ繝･騾夂衍・亥ｰ・擂逕ｨ・・笏笏 */
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  self.registration.showNotification(data.title || 'VR Homes', {
    body: data.body || '譁ｰ逹迚ｩ莉ｶ縺ｮ縺顔衍繧峨○',
    icon: './icon-192.png',
    badge: './icon-192.png',
  });
});
