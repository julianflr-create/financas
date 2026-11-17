/* Service worker: o app abre mesmo sem internet; lançamentos ficam na fila.
   Arquivos do app: rede primeiro (pega atualizações na hora), cópia local se estiver offline. */
const VERSAO = 'fin2026-v4';
const SHELL = ['./', 'index.html', 'app.js', 'xcore.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const local = u.origin === location.origin;
  const fonte = /fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (!local && !fonte) return; // Microsoft Graph, login e downloads: sempre pela rede
  if (local && u.search.includes('code=')) return;
  e.respondWith(caches.open(VERSAO).then(async (c) => {
    if (local) {
      try { const r = await fetch(e.request, { cache: 'no-cache' }); if (r.ok) c.put(e.request, r.clone()); return r; }
      catch (err) { return (await c.match(e.request, { ignoreSearch: true })) || Response.error(); }
    }
    const hit = await c.match(e.request);
    if (hit) return hit;
    const r = await fetch(e.request); if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r;
  }));
});
