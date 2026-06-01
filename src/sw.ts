/// <reference lib="WebWorker" />

// eslint-disable-next-line no-restricted-globals
const BUILD_VERSION = (globalThis as unknown as { __BUILD_VERSION__?: string }).__BUILD_VERSION__ ?? 'dev';
const CACHE_NAME = `space-rangers-v${BUILD_VERSION}`;
const MODEL_CACHE_NAME = `space-rangers-models-v${BUILD_VERSION}`;

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/offline-fallback.html',
];

const sw = self as unknown as ServiceWorkerGlobalScope;

// Install: cache core assets
sw.addEventListener('install', (event) => {
  const e = event as ExtendableEvent;
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    }),
  );
  sw.skipWaiting();
});

// Activate: clean up old caches
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

// Message handler for skipWaiting from client
sw.addEventListener('message', (event) => {
  const e = event as ExtendableMessageEvent;
  if (e.data === 'SKIP_WAITING') {
    sw.skipWaiting();
  }
});

// Fetch: stale-while-revalidate for HTML/JS/CSS, cache-first for immutable assets, offline fallback
sw.addEventListener('fetch', (event) => {
  const e = event as FetchEvent;
  const request = e.request;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Stale-while-revalidate for ONNX and WASM files
  if (url.pathname.endsWith('.onnx') || url.pathname.endsWith('.wasm')) {
    e.respondWith(
      caches.open(MODEL_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        
        // Return cached response immediately (stale)
        if (cached) {
          // Background revalidate
          fetch(request).then((response) => {
            if (response.ok) {
              cache.put(request, response.clone());
            }
          }).catch(() => {
            // Network failed, keep cached version
          });
          return cached;
        }
        
        // No cache, fetch from network
        const response = await fetch(request);
        if (response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      }),
    );
    return;
  }

  // For HTML navigation requests: network-first to always get latest app shell
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
          // Offline: fallback to cache
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

  // For JS/CSS: stale-while-revalidate (fast load + background update)
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
          // Network failed
          if (cached) return cached;
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
        });

        if (cached) {
          // Return cached immediately, update in background
          networkPromise.catch(() => {});
          return cached;
        }

        // Nothing cached, wait for network
        return networkPromise;
      }),
    );
    return;
  }

  // Cache-first for all other static assets (images, fonts, etc.)
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
