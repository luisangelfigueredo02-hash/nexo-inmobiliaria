# Changelog

Todos los cambios notables del producto NEXO. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Unreleased] — Final Productization (Master Execution Mission)

### Corregido (P0)
- **Media R2 WebP 500**: `headers.set("Vary", "Accept")` ahora pasa el valor
  correcto en la rama de negociación WebP (era un TypeError que devolvía 500
  en todos los navegadores modernos con `Accept: image/webp`).
- **Mapa en blanco**: Leaflet self-hosted (`/vendor/leaflet/`) con fallback a
  CDN, y estado explícito cuando no hay inmuebles geolocalizados (antes
  quedaba un sidebar mudo "Consultando catálogo…").
- **Placeholder legal**: eliminado texto "LEGAL CONTENT REQUIRES HUMAN
  CONFIRMATION" del footer público.

### Añadido
- **White-label config**: `/api/config` expone `brand` (name/logo/description/
  tagline/theme_color), `business` (email/phone/address) y `social`, todo
  controlado por variables de entorno. SEO dinámico usa `BRAND_NAME`.
- **Subida de imágenes a R2**: nuevo endpoint `POST /api/admin/upload-image`
  (valida tipo y 5MB) + UI en admin con drag & drop, barra de progreso y
  reordenado de galería.
- **Bulk CSV**: importar/exportar inmuebles desde el panel admin.
- **Demo mode**: `DEMO_MODE` + banner "Modo demostración" en la UI y
  `scripts/seed-demo.mjs` (25 propiedades con coordenadas reales de Cuba) /
  `--clear`.
- **Trust bar** en el hero (conteo real de propiedades) y navegación de header
  unificada (Explorar/Mapa/Comparar/IA).
- **Docs de takeover**: `TAKEOVER.md`, `LICENSE` (MIT), `CHANGELOG.md`.
- **Tests**: cobertura de la negociación WebP en `/media` (rama que fallaba).

### Cambiado
- Header nav unificada y coherente entre páginas.
- Service Worker bump a `nexo-v7-map-assets`.
- Eliminado `public/config.js` (código muerto sin referencias).
