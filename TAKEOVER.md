# NEXO — Guía de takeover (transferencia del producto)

Esta guía explica cómo adquirir, renombrar, desplegar y poblar NEXO como
plataforma inmobiliaria white-label propia. Todo el sistema vive en **un solo
Cloudflare Worker** (`nexo-inmueble`).

---

## 1. Arquitectura (resumen canónico)

| Componente | Recurso | Binding en worker.js |
|---|---|---|
| Código | `worker.js` (entrypoint) + `public/` (assets) | — |
| Base de datos | D1 `nexo-db` | `DB` |
| Imágenes | R2 `nexo-media` | `BUCKET_IMAGENES` |
| Búsqueda IA | Vectorize `nexo-index` | `VECTOR_INDEX` |
| Modelo IA | Workers AI | `AI` |
| Assets estáticos | `public/` | `ASSETS` |

Variables de entorno en `wrangler.toml [vars]`. Secretos con
`wrangler secret put <NAME>` (nunca en el repo).

---

## 2. Rebranding / white-label

Todo lo configurable por el comprador se sirve en `/api/config` y se define con
variables de entorno en `wrangler.toml`:

| Variable | Efecto |
|---|---|
| `BRAND_NAME` | Nombre de marca (título SEO, OG, config) |
| `BRAND_DESCRIPTION` | Descripción SEO/OG |
| `BRAND_TAGLINE` | Lema |
| `BRAND_THEME_COLOR` | Color de tema (PWA/meta) |
| `BRAND_LOGO` | Ruta del logo (p. ej. `/icons/icon-192.png`) |
| `WHATSAPP_PHONE` | Número de contacto (CTA WhatsApp) |
| `CONTACT_EMAIL` / `CONTACT_PHONE` / `BUSINESS_ADDRESS` | Datos de contacto |
| `SOCIAL_INSTAGRAM` / `SOCIAL_FACEBOOK` / `SOCIAL_LINKEDIN` | Redes |
| `MARKET_COUNTRY` / `MARKET_LOCALE` / `DEFAULT_CURRENCY` | Mercado |
| `MAP_CENTER_LAT` / `MAP_CENTER_LNG` / `MAP_ZOOM` | Centro/zoom inicial del mapa |
| `DEMO_MODE` | `"1"` muestra banner "Modo demostración" |

> Los textos visibles "NEXO" en las páginas (`public/*.html`) son literales.
> Para un rebrand completo, sustituir el nombre/logo en el header, footer y
> hero de `index.html`, `property.html`, `comparar/`, `mapa/`, `ia/`.

---

## 3. Despliegue

```bash
npm install
npx wrangler login            # o export CLOUDFLARE_API_TOKEN=...
npx wrangler deploy
```

El worker queda en `https://<name>.<cuenta>.workers.dev`. Para dominio propio:
Cloudflare → Workers → tu worker → Settings → Triggers → Custom Domains.

CI/CD: `.github/workflows/deploy.yml` despliega en push a `main` con
`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID` como secrets de GitHub.

---

## 4. Base de datos (D1)

```bash
# Local
npx wrangler d1 execute nexo-db --local --file=schema.sql
npx wrangler d1 migrations apply nexo-db --local

# Producción
npx wrangler d1 migrations apply nexo-db --remote
```

Esquema canónico: `schema.sql` + migraciones `migrations/0001–0005`.
`properties.id` (INTEGER PK interno) + `properties.public_code` (`N-001`, público).

---

## 5. Datos de demostración

Para mostrar el producto con inventario de ejemplo (claramente rotulado):

```bash
node scripts/seed-demo.mjs                 # genera demo-seed.sql (25 props, coords reales)
wrangler d1 execute nexo-db --remote --file=./demo-seed.sql

# Banner de demo en la UI
#   wrangler.toml → DEMO_MODE = "1"  → redeploy

# Limpiar todos los datos demo
node scripts/seed-demo.mjs --clear         # genera demo-clear.sql
wrangler d1 execute nexo-db --remote --file=./demo-clear.sql
```

Los `.sql` generados **no se versionan** (se generan bajo demanda).

---

## 6. Gestión de inmuebles (admin)

- URL: `/admin.html`
- Auth: `Bearer` token → `wrangler secret put ADMIN_TOKEN`
- Funciones: crear/editar/publicar/eliminar, subir imágenes (R2), reordenar
  galería, geolocalización por clic en mapa, **importar/exportar CSV**.

---

## 7. Secretos a rotar al transferir

- `ADMIN_TOKEN` (nuevo valor)
- Credenciales Cloudflare del comprador
- `SENTRY_DSN` (si se usa observabilidad propia)

**Nunca** commitear tokens. Rotar cualquier secreto que haya aparecido en
`~/.cf_token`, `~/.gh_token` o historiales compartidos.

---

## 8. Verificación post-despliegue

```bash
curl https://<dominio>/api/health
curl https://<dominio>/api/config
npm test        # suite local
```
