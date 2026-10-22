/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};
const manifest = self.__WB_MANIFEST;
const prefix = 'ai-tasks-shell:';
const cacheName = prefix + manifest.map((asset) => `${asset.revision}:${asset.url}`).join('|');
const assets = new Set(manifest.map((asset) => new URL(asset.url, self.registration.scope).href));
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([...assets])));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  const message: unknown = event.data;
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'ACTIVATE_UPDATE'
  )
    event.waitUntil(self.skipWaiting());
});
async function navigation(request: Request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await (
      await caches.open(cacheName)
    ).match(new URL('index.html', self.registration.scope));
    return (
      shell ??
      new Response('Приложение ещё не сохранено для работы без сети.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    );
  }
}
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  )
    return;
  if (event.request.mode === 'navigate') event.respondWith(navigation(event.request));
  else if (assets.has(url.href))
    event.respondWith(
      (async () => {
        const cached = await (await caches.open(cacheName)).match(event.request);
        return cached ?? fetch(event.request);
      })(),
    );
});
