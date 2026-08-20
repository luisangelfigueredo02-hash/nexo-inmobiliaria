/// public/sw.js
/* =========================================================
   NEXO Service Worker - "Modo Isla" (Offline First for Cuba)
   Arquitectura de caché ultra-resiliente.
========================================================= */

const SW_VERSION = "nexo-v2-premium";
const STATIC_CACHE = `${SW_VERSION}-static`;
const DATA_CACHE = `${SW_VERSION}-data`;
const IMAGE_CACHE = `${SW_VERSION}-images`;

const SHELL_URLS = [
  "/",
  "/index.html",
  "/property.html",
  "/variables.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

// Instalar y forzar activación inmediata
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then(cache => cache.addAll(SHELL_URLS))
  );
});

// Limpiar cachés antiguos
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => !key.startsWith(SW_VERSION)).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

// Enrutador de peticiones (Fetch)
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);

  // Evitar interceptar peticiones no GET o rutas administrativas
  if (request.method !== "GET" || url.pathname.startsWith("/api/admin/")) {
    return;
  }

  // 1. IMÁGENES: Cache-First con fallback a red
  if (request.destination === 'image' || url.pathname.startsWith("/media/")) {
    event.respondWith(
      caches.match(request).then(cachedResponse => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then(networkResponse => {
          if (networkResponse.ok) {
            const clone = networkResponse.clone();
            caches.open(IMAGE_CACHE).then(cache => cache.put(request, clone));
          }
          return networkResponse;
        }).catch(() => {
          // Si falla, retornar un placeholder o SVG genérico si existiera
          return new Response('<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f5f5f7"/></svg>', { headers: { 'Content-Type': 'image/svg+xml' }});
        });
      })
    );
    return;
  }

  // 2. API DE DATOS: Stale-While-Revalidate (El Modo Isla)
  // Devuelve caché instantáneo si existe, pero actualiza en background.
  if (url.pathname.startsWith("/api/properties")) {
    event.respondWith(
      caches.open(DATA_CACHE).then(async cache => {
        const cachedResponse = await cache.match(request);
        const fetchPromise = fetch(request).then(networkResponse => {
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(err => {
          if (!cachedResponse) throw err;
        });
        
        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 3. ARCHIVOS ESTÁTICOS Y NAVEGACIÓN: Network-First con Fallback a Caché Shell
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const clone = response.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
      }
      return response;
    }).catch(() => {
      return caches.match(request).then(cached => {
        return cached || caches.match("/"); // Fallback de navegación a la home offline
      });
    })
  );
});