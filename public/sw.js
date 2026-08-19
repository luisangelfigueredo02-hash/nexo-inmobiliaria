/* =========================================================
   NEXO Service Worker
   - Cache-First: estáticos del shell y librerías CDN
   - Network-First + fallback a caché: API pública (propiedades)
   - Nunca cachea rutas administrativas
========================================================= */

const SW_VERSION = "nexo-v1";

const STATIC_CACHE = `${SW_VERSION}-static`;
const RUNTIME_CACHE = `${SW_VERSION}-runtime`;

const SHELL_URLS = [
  "/",
  "/variables.css",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

const CACHEABLE_API = [
  /^\/api\/properties(?:$|\/)/,
  /^\/api\/images$/
];


/* --------------------------------------------------------
   INSTALL — precache del shell
-------------------------------------------------------- */

self.addEventListener(
  "install",
  event => {

    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then(cache =>
          cache.addAll(SHELL_URLS)
        )
        .then(() => self.skipWaiting())
    );

  }
);


/* --------------------------------------------------------
   ACTIVATE — limpieza de caches obsoletos
-------------------------------------------------------- */

self.addEventListener(
  "activate",
  event => {

    event.waitUntil(
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key =>
                !key.startsWith(SW_VERSION)
              )
              .map(key => caches.delete(key))
          )
        )
        .then(() => self.clients.claim())
    );

  }
);


/* --------------------------------------------------------
   HELPERS
-------------------------------------------------------- */

function isStaticAsset(
  url
) {

  if (url.origin === location.origin) {

    return (
      /\.(?:css|js|png|jpg|jpeg|webp|svg|woff2?|ico|json)$/.test(
        url.pathname
      ) &&
      !url.pathname.startsWith("/api/")
    );

  }

  /*
   * Librerías CDN (MapLibre / Leaflet) con
   * caché generosa: son versiones pineadas.
   */

  return url.hostname === "unpkg.com";

}


function isCacheableAPI(
  url
) {

  return (
    url.origin === location.origin &&
    CACHEABLE_API.some(
      pattern =>
        pattern.test(url.pathname)
    )
  );

}


async function cacheFirst(
  request
) {

  const cached =
    await caches.match(request);

  if (cached) {

    return cached;

  }


  const response =
    await fetch(request);


  if (
    response.ok &&
    (response.type === "basic" ||
     response.type === "cors")
  ) {

    const cache =
      await caches.open(
        STATIC_CACHE
      );

    cache.put(
      request,
      response.clone()
    );

  }


  return response;

}


async function networkFirst(
  request
) {

  try {

    const response =
      await fetch(request);


    if (response.ok) {

      const cache =
        await caches.open(
          RUNTIME_CACHE
        );

      cache.put(
        request,
        response.clone()
      );

    }


    return response;

  } catch (error) {

    const cached =
      await caches.match(request);

    if (cached) {

      return cached;

    }

    throw error;

  }

}


/* --------------------------------------------------------
   FETCH — enrutamiento de estrategias
-------------------------------------------------------- */

self.addEventListener(
  "fetch",
  event => {

    const request =
      event.request;


    /* Solo GET; POST/mutaciones pasan directas. */

    if (request.method !== "GET") {

      return;

    }


    const url =
      new URL(request.url);


    /* Nunca interceptar la administración. */

    if (
      url.origin === location.origin &&
      url.pathname.startsWith("/api/admin/")
    ) {

      return;

    }


    if (isCacheableAPI(url)) {

      event.respondWith(
        networkFirst(request)
      );

      return;

    }


    if (isStaticAsset(url)) {

      event.respondWith(
        cacheFirst(request)
      );

      return;

    }


    /* Navegación: red primero, shell como fallback. */

    if (
      request.mode === "navigate" &&
      url.origin === location.origin
    ) {

      event.respondWith(
        fetch(request)
          .catch(() =>
            caches.match("/")
          )
      );

    }

  }
);
