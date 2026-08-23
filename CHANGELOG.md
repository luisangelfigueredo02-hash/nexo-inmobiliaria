# Changelog

Todos los cambios notables del producto NEXO. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/).

## [Unreleased] — Sale Hardening (Gates 19–21, 2026-08-23)

### Corregido
- **`/api/chat` hardened**: rate limit scoped 10 req/5 min/IP y rechazo 400 de
  mensajes no-string o >2000 chars (antes: solo límite general 20/min).
- **Precios demo sin moneda**: backfill `currency='USD'` en inventario demo y
  fix en `scripts/seed-demo.mjs` (la UI mostraba `79,717` en vez de `US$79,717`).
- **`/robots.txt` hardcodeaba el dominio personal**: ahora se genera dinámico
  con el origin real (white-label).
- **Manifest**: dinámico desde brand; referencia a icono maskable inexistente
  (404) eliminada; `public/manifest.json` estático (código muerto) eliminado.
- **`src/brand.js`**: el default de WhatsApp ya no embebe el teléfono del
  operador; con `WHATSAPP_PHONE` vacío los CTAs se ocultan sin enlaces rotos.
- **`DEPLOYMENT.md`**: sección de migraciones corregida (usar siempre
  `scripts/apply-migrations.mjs`; el ALTER de 0007 falla por columna
  duplicada en una D1 nueva con `wrangler d1 migrations apply`) y comando de
  rollback corregido (`wrangler rollback <version-id>`).

### Cambiado
- `README.md` reescrito: API real, despliegue real, cifra de tests real.
- Datos personales sanitizados en D1 producción (cuentas de prueba
  anonimizadas/eliminadas, sesiones y favoritos purgados).

## [Unreleased] — Master Productization & Sale-Ready (Fases 06–12)

### Añadido (FASE 07)
- **Sistema público de usuarios**: `POST /api/auth/register`, `POST /api/auth/login`,
  `GET|PUT|DELETE /api/me/favorites`. Passwords PBKDF2-SHA256 100k (Workers),
  cookie `__Host-session` (HttpOnly/Secure/SameSite=Lax, rotación y revocación).
- **`/cuenta/`**: página de cuenta con tabs login/registro, favoritos sincronizados
  y logout. Favoritos locales anónimos se fusionan al servidor al autenticarse.
- Migration **0006**: `accounts.password_hash` + `account_favorites`.
- Aislamiento admin: el plano público nunca habilita admin (tests).

### Corregido
- **PBKDF2 210k → 100k**: Cloudflare Workers rechaza iteraciones >100000
  (NotSupportedError verificado en producción; antes: registro 500).
- Trust-bar concordancia ("1 propiedad"); chip "Más filtros" consistente.

### Documentación (FASE 12)
- `DEPLOYMENT.md`, `SECURITY.md`, `ARCHITECTURE.md` + `reports/06..12-*`.

### Decisión documentada
- La spec 04.0 era passwordless-first, pero magic link requiere email provider
  inexistente → email+password PBKDF2 adoptado (ver `reports/07-user-system.md`).
- Recovery de cuenta: P1 abierta (requiere proveedor de email).

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
