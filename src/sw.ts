/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { SHARE_TARGET_PATH } from './manifest';
import { SHARE_CACHE, SHARED_FILE_URL, SHARED_NAME_HEADER } from './platform/shared';

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// The app asks to activate a new version when the user taps "Actualizar".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// Android's share sheet POSTs the file here. Keep it for the app and open the import preview.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith(`/${SHARE_TARGET_PATH}`)) return;

  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const file = form.get('file');
      if (file instanceof File) {
        const cache = await caches.open(SHARE_CACHE);
        await cache.put(
          SHARED_FILE_URL,
          new Response(file, {
            headers: { 'Content-Type': file.type, [SHARED_NAME_HEADER]: encodeURIComponent(file.name) },
          }),
        );
      }
      return Response.redirect(new URL('./#/importar?compartido=1', self.registration.scope).href, 303);
    })(),
  );
});
