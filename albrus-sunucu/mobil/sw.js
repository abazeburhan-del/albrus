// Albrus Mobil — service worker. Uygulama kabuğunu önbelleğe alır (çevrimdışı açılış);
// veri istekleri (/api/*) HER ZAMAN ağdan gider, önbelleğe alınmaz.
const KABUK = 'albrus-kabuk-v1';
const DOSYALAR = ['/', '/manifest.json', '/mobil/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(KABUK).then((c) => c.addAll(DOSYALAR)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== KABUK).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/')) return;                 // veri: ağ (önbellek yok)
  e.respondWith(
    fetch(e.request).then((r) => {
      if (e.request.method === 'GET' && r.ok) { const kopya = r.clone(); caches.open(KABUK).then((c) => c.put(e.request, kopya)); }
      return r;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('/')))
  );
});
