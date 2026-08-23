# FASE 10 — Map + Media + PWA

## MAP (VERIFIED)
- Leaflet 1.9.4 self-hosted en `/vendor/leaflet/` (js/css/imágenes) + fallback CDN
  en home, mapa y admin.
- Markers: el mapa consume `latitude/longitude` reales; si ningún inmueble tiene
  coords → estado explícito "sin inmuebles geolocalizados" (no lienzo negro).
- Degradación: sin internet/no leaflet → estado de error correcto.
- No se inventaron coordenadas (la única propiedad real las tiene NULL).

## MEDIA (VERIFIED)
- `/media/*`: JPG/PNG/WebP; negociación `Accept: image/webp` → 200 image/webp
  + `Vary: Accept` (P0-1 de la misión anterior; test dedicado).
- Upload admin: validación MIME + 5MB, R2, variantes -w400/-w800/-w1200, reorder.
- Fallback `data-fallback-src` en cards; lazy loading `loading="lazy"`.

## PWA (VERIFIED)
- `manifest.json` + icons (192/512).
- `sw.js` versionado (`nexo-v7-map-assets`); precache del shell, runtime cache
  de imágenes; excluye `/api/session/*`, `/api/auth/*`, `/api/me/*` (no-store).
- Invalidación: cada bump de SW_VERSION fuerza refresco (evita assets stale).
- Installability: meta theme-color + manifest; falta Lighthouse formal (UNKNOWN).

## Tests de comportamiento (VERIFIED en suite)
- Media WebP branch con mock R2 (P0-1), auth/session excluidos de cache.

## Gate 10
- Chrome desktop: VERIFIED (screenshots).
- Safari / mobile viewport: ESTIMATED (viewport-meta + tokens; no device real).
- Offline: PARTIAL (shell + imágenes cacheadas; catálogo requiere red).
- Slow network: ESTIMATED (lazy + responsive srcset; no test de 3G real).
