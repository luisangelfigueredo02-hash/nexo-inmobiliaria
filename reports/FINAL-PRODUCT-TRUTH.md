# FINAL PRODUCT TRUTH — Estado actual verificado (pre-implementación)

**Fecha:** 2026-08-23 | **Método:** verificación directa contra código, Git, producción, Cloudflare y navegador.
**Clasificación:** VERIFIED = comprobado | INFERRED = deducido de código | ESTIMATED = no medido | UNKNOWN = no comprobado.

| Componente | Estado | Evidencia |
|---|---|---|
| Git | VERIFIED | SHA a4c67c8, main, tree limpio, remote GitHub OK, shallow clone |
| CI (GitHub Actions) | VERIFIED | `.github/workflows/deploy.yml` quality gates + wrangler deploy on push main |
| Cloudflare auth | VERIFIED | CLOUDFLARE_API_TOKEN válido; account 8816663cf4f1768c51859f07ab8305f4 |
| Worker | VERIFIED | https://nexo-inmueble.luisangelfigueredo02.workers.dev 200; TTFB ~100ms |
| D1 | VERIFIED | nexo-db; properties=1 (N-001, lat/lng NULL); migrations 0001-0005 aplicadas |
| R2 | VERIFIED | nexo-media; /media GET funciona; variantes -w400.webp existen |
| Vectorize | INFERRED | binding declarado; sincronización best-effort en create/update/delete |
| Workers AI | VERIFIED | binding AI; modelo @cf/google/gemma-4-26b-a4b-it en código |
| Routes públicas | VERIFIED | /, /property.html, /mapa/, /comparar/, /ia/, /api/properties, /api/config, /sitemap.xml |
| Admin auth | VERIFIED | Bearer ADMIN_TOKEN timing-safe; /api/admin/verify rate-limited |
| Sessions | INFERRED | session-runtime.js (cookie hash, D1); sin endpoints públicos de login |
| Media pipeline | FAILED | Accept: image/webp → 500 por `headers.set("Vary")` sin valor |
| Mapa | FAILED | lienzo gris en browser real (0 coords + Leaflet único CDN) |
| PWA | VERIFIED | manifest + icons + sw.js (shell + image cache + excluye session/admin) |
| SEO | VERIFIED | dynamic meta + canonical + OG + JSON-LD + sitemap.xml |
| Security headers | VERIFIED | CSP hash, HSTS preload, XFO, XCTO, Permissions-Policy |
| Rate limit | PARTIAL | cubre chat/session/verify; no GET /api/properties |
| Public user accounts | MISSING | no registro/login/perfil |

## P0 confirmados
1. Media 500 en Accept webp (bug Vary).
2. Mapa no funcional.
3. Placeholder legal en footer.
4. Inventario = 1 inmueble.
5. Admin sin upload de imágenes.

Continuación: implementación P0 inmediata.
