/* =========================================================
   NEXO Service Worker - "Modo Isla" (Offline-First Real)
   Arquitectura de caché ultra-resiliente para Cuba.
========================================================= */

const SW_VERSION = "nexo-v10-static-swr";
const STATIC_CACHE = `${SW_VERSION}-static`;
const DATA_CACHE = `${SW_VERSION}-data`;
const IMAGE_CACHE = `${SW_VERSION}-images`;

const SHELL_URLS = [
  "/",
  "/index.html",
  "/property.html",
  "/variables.css",
  "/manifest.json",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/placeholder.svg"
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

  // 1. Nunca interceptar peticiones que no sean GET ni rutas administrativas
  //    ni endpoints autenticados (04.3/14F): la Cache API NO respeta no-store;
  //    cachear /api/session/*, /api/auth/* o /api/me/* sería un cache leak de
  //    estado autenticado y de datos privados (favoritos de la cuenta).
  if (
    request.method !== "GET" || 
    url.pathname.startsWith("/api/admin/") || 
    url.pathname.startsWith("/api/session/") ||
    url.pathname.startsWith("/api/auth/") ||
    url.pathname.startsWith("/api/me/") ||
    url.pathname === "/admin.html"
  ) {
    return;
  }

  // 2. IMÁGENES: Cache-First con fallback a red
  if (request.destination === "image" || url.pathname.startsWith("/media/")) {
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
          return new Response(
            '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f5f5f7"/></svg>',
            { headers: { "Content-Type": "image/svg+xml" } }
          );
        });
      })
    );
    return;
  }

  // 3. API DE DATOS: Stale-While-Revalidate con frescura limitada (Modo Isla).
  // Inventario: revalidamos si el cache tiene más de DATA_MAX_AGE_MS; el detalle
  // de propiedad es más estable (el inventario cambia con publicaciones).
  const DATA_MAX_AGE_MS = url.pathname.includes("/api/properties") && !/\/api\/properties\//.test(url.pathname)
    ? 5 * 60 * 1000        // inventario: 5 minutos
    : 30 * 60 * 1000;      // detalle/config: 30 minutos

  if (url.pathname.startsWith("/api/properties") || url.pathname === "/api/config") {
    event.respondWith(
      caches.open(DATA_CACHE).then(async cache => {
        const cachedResponse = await cache.match(request);
        const isFresh = cachedResponse &&
          Date.now() - new Date(cachedResponse.headers.get("date") || 0).getTime() < DATA_MAX_AGE_MS;

        const fetchPromise = fetch(request).then(networkResponse => {
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        }).catch(err => {
          if (!cachedResponse) throw err;
        });

        return Promise.resolve(
          isFresh ? cachedResponse : fetchPromise
        ).catch(() => cachedResponse || fetchPromise);
      })
    );
    return;
  }

  // 4. NAVEGACIÓN: Network-First con fallback resiliente ignorando query params
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        // Búsqueda con ignoreSearch: permite que /property.html?id=N-001 cargue el shell correcto
        const cachedPage = await caches.match(request, { ignoreSearch: true });
        if (cachedPage) return cachedPage;

        if (url.pathname.startsWith("/property")) {
          const propertyShell = await caches.match("/property.html");
          if (propertyShell) return propertyShell;
        }

        return caches.match("/");
      })
    );
    return;
  }

  // 5. OTROS ESTÁTICOS (CSS, JS, manifest, fonts): Stale-While-Revalidate.
  // Cache-first puro dejaría CSS/JS obsoletos para siempre (la caché solo se
  // purga al cambiar SW_VERSION); SWR mantiene el modo offline y a la vez
  // actualiza la caché en segundo plano en cada visita con red.
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(response => {
        if (response.ok && response.type === "basic") {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      });
      return cached || network;
    })
  );
});