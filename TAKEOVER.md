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

El white-label es **real y sin tocar código**: el worker sustituye tokens
`{{BRAND_*}}` en el HTML servido (transform en `src/brand.js`, fuente única de
config) con las variables de entorno de `wrangler.toml [vars]`. Todo lo
configurable también se expone en `/api/config`:

| Variable | Efecto |
|---|---|
| `BRAND_NAME` | Nombre de marca (header, footer, título SEO, OG, manifest PWA) |
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

Para rebrand: editar `[vars]`, `npx wrangler deploy`. Sin búsqueda/reemplazo
manual en el HTML.

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

# Producción (D1 recién creada: schema.sql PRIMERO — crea `properties`;
# la migración 0002 hace ALTER sobre ella y fallaría sin este paso)
npx wrangler d1 execute nexo-db --remote --file=schema.sql
npx wrangler d1 migrations apply nexo-db --remote
```

Esquema canónico: `schema.sql` + migraciones `migrations/0001–0007`.
`properties.id` (INTEGER PK interno) + `properties.public_code` (`N-001`, público).

---

## 5. Datos de demostración

Para mostrar el producto con inventario de ejemplo (claramente rotulado con
badge DEMO en la UI y marca de agua en las imágenes):

```bash
node scripts/seed-demo.mjs                 # genera demo-seed.sql (25 props, coords reales, imágenes propias)
wrangler d1 execute nexo-db --remote --file=./demo-seed.sql

# Banner de demo en la UI
#   wrangler.toml → DEMO_MODE = "1"  → redeploy

# Limpiar todos los datos demo
node scripts/seed-demo.mjs --clear         # genera demo-clear.sql
wrangler d1 execute nexo-db --remote --file=./demo-clear.sql
```

Los `.sql` generados **no se versionan** (se generan bajo demanda). Las
imágenes demo (`public/demo-media/*.svg`) son ilustraciones propias sin
licencias de terceros; el clear solo borra filas `D-*`/`internal_notes='DEMO'`,
nunca inventario real.

---

## 5b. Backup y rollback

```bash
# Backup de D1 antes de cualquier operación de datos
npx wrangler d1 export nexo-db --remote --output=backup-$(date +%F).sql

# Rollback de código: Cloudflare → Workers → nexo-inmueble →
#   Deployments → seleccionar versión anterior → Rollback (instantáneo)
```

Guardar los backups **fuera del repo** (contienen datos de producción).

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
