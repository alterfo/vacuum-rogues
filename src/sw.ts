/// <reference lib="WebWorker" />

import { buildCacheNames } from './systems/sw/cacheNames';

declare const __BUILD_VERSION__: string;
declare const __BUILD_SHA__: string;

const BUILD_VERSION = typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'dev';
const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev';
const { cache: CACHE_NAME, modelCache: MODEL_CACHE_NAME } = buildCacheNames(
  BUILD_VERSION,
  BUILD_SHA,
);

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/offline-fallback.html',
];

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    }),
  );
  sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== MODEL_CACHE_NAME)
          .map((name) => caches.delete(name)),
      );
    }),
  );
  sw.clients.claim();
});

sw.addEventListener('message', (event) => {
  const e = event as ExtendableMessageEvent;
  if (e.data === 'SKIP_WAITING') {
    sw.skipWaiting();
  }
});

sw.addEventListener('fetch', (event) => {
  const e = event as FetchEvent;
  const request = e.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') {
    return;
  }

  if (url.pathname.endsWith('.onnx') || url.pathname.endsWith('.wasm')) {
    e.respondWith(
      caches.open(MODEL_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        
        if (cached) {
          fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
          }).catch(() => {
            // Network failed, keep cached version
          });
          return cached;
        }
        
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match('/offline-fallback.html').then((fallback) => {
              return fallback || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
            });
          });
        }),
    );
    return;
  }

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    e.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);

        const networkPromise = fetch(request).then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(() => {
          if (cached) return cached;
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });

        if (cached) {
          networkPromise.catch(() => {});
          return cached;
        }

        return networkPromise;
      }),
    );
    return;
  }

  e.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      
      return fetch(request).then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
      });
    }),
  );
});
