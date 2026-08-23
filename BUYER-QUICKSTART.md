# BUYER QUICKSTART — NEXO

**¿Puedes tener NEXO funcionando bajo tu propia marca hoy? Sí.** Una persona
con conocimientos básicos de Cloudflare puede completar el takeover en
**45–90 minutos** (ESTIMATED, verificado paso a paso contra la documentación
y la producción real el 2026-08-23).

Todo el sistema vive en **un solo Cloudflare Worker**. No hay servidores que
administrar, no hay build de frontend, no hay framework JS que compilar.

---

## Paso 0 — Qué necesitas

- Una cuenta de Cloudflare (el plan gratuito funciona para empezar; Workers
  Paid (~$5/mes) se recomienda para producción con tráfico real).
- Node.js ≥ 18 en tu máquina.
- El repositorio (transferido vía GitHub o como fork/zip).

## Paso 1 — Clonar e instalar (2 min)

```bash
git clone <repo-transferido>
cd nexo-inmobiliaria
npm install
npm test        # 249 pruebas deben pasar en verde
```

## Paso 2 — Autenticar Wrangler (3 min)

```bash
npx wrangler login
# o: export CLOUDFLARE_API_TOKEN=... (token con permisos Workers/D1/R2)
```

## Paso 3 — Crear los recursos Cloudflare (10 min)

```bash
# Base de datos
npx wrangler d1 create nexo-db
# → copia el database_id que imprime

# Bucket de imágenes
npx wrangler r2 bucket create nexo-media

# Índice vectorial para el asistente IA (768 dimensiones, cosine)
npx wrangler vectorize create nexo-index --dimensions=768 --metric=cosine

# Workers AI no requiere creación: el binding [ai] ya está en wrangler.toml
```

Edita `wrangler.toml`:

- `database_id = "<el-id-que-copiaste>"` en `[[d1_databases]]`
- (Opcional) cambia `name = "nexo-inmueble"` por el nombre de tu worker

## Paso 4 — Inicializar la base de datos (5 min)

**Orden obligatorio** (el script de migraciones hace ALTER sobre tablas que
`schema.sql` crea):

```bash
npx wrangler d1 execute nexo-db --remote --file=schema.sql
node scripts/apply-migrations.mjs --remote
```

> Usa SIEMPRE `scripts/apply-migrations.mjs` (nunca `wrangler d1 migrations
> apply`): la migration 0007 es idempotente solo a través del script.

## Paso 5 — Configurar tu marca (10 min)

Edita `[vars]` en `wrangler.toml` (nada de esto toca código):

```toml
BRAND_NAME = "Tu Marca"
BRAND_TAGLINE = "Tu lema"
BRAND_DESCRIPTION = "Tu descripción SEO"
BRAND_PRIMARY_COLOR = "#tu-color"
BRAND_THEME_COLOR = "#1C1917"
WHATSAPP_PHONE = "+53XXXXXXXX"        # vacío = CTAs de WhatsApp se ocultan
CONTACT_EMAIL = "hola@tumarca.com"
CONTACT_PHONE = "+53XXXXXXXX"
SOCIAL_INSTAGRAM = "https://instagram.com/tumarca"
MARKET_COUNTRY = "Cuba"               # o tu país
DEFAULT_CURRENCY = "USD"
MAP_CENTER_LAT = "23.1136"            # centro inicial del mapa
MAP_CENTER_LNG = "-82.3666"
MAP_ZOOM = "12"
DEMO_MODE = "0"                       # "1" solo mientras muestres demo
```

## Paso 6 — Secreto de administración (2 min)

```bash
npx wrangler secret put ADMIN_TOKEN   # pega un token largo y aleatorio
```

## Paso 7 — Desplegar (2 min)

```bash
npx wrangler deploy
```

Tu plataforma queda en `https://<tu-worker>.<tu-subdomain>.workers.dev`.

## Paso 8 — Inventario de demostración (opcional, 5 min)

Para ver el producto con 25 propiedades de ejemplo claramente rotuladas
(badge DEMO + banner "Modo demostración"):

```bash
node scripts/seed-demo.mjs                                # genera demo-seed.sql
npx wrangler d1 execute nexo-db --remote --file=./demo-seed.sql
# DEMO_MODE = "1" en [vars] + redeploy para mostrar el banner
```

Borrado reversible (solo filas demo, nunca inventario real):

```bash
node scripts/seed-demo.mjs --clear                        # genera demo-clear.sql
npx wrangler d1 execute nexo-db --remote --file=./demo-clear.sql
```

## Paso 9 — Verificación (5 min)

```bash
curl https://<tu-dominio>/api/health      # {"ok":true,...}
curl https://<tu-dominio>/api/config      # debe mostrar TU marca
```

Abre en el navegador: `/` (catálogo), `/admin` (panel con tu ADMIN_TOKEN),
`/mapa/`, `/ia/`, `/cuenta/`.

## Paso 10 — Dominio propio (opcional, 10–20 min)

Cloudflare Dashboard → Workers → tu worker → Settings → Domains & Routes →
Add Custom Domain. El dominio debe estar en Cloudflare DNS (gratis).

Ningún dominio queda hardcodeado: `/robots.txt`, `/sitemap.xml` y
`/manifest.webmanifest` se generan dinámicamente con el origin real.

## Paso 11 — Cargar tu inventario (variable)

Tres vías, todas desde `/admin` con tu ADMIN_TOKEN:

1. **Formulario**: crear propiedad a propiedad, con subida de imágenes
   (drag & drop, máx 5 MB, validación MIME) y geolocalización por clic.
2. **CSV**: importación masiva (columnas documentadas en el propio panel).
3. **API**: `POST /api/admin/properties` con `Authorization: Bearer`.

## Paso 12 — CI/CD (opcional, 10 min)

En tu GitHub: Settings → Secrets → Actions:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Cada push a `main` ejecutará tests (249) y desplegará automáticamente.

---

## Tiempos realistas (ESTIMATED)

| Escenario | Tiempo |
|---|---|
| Solo desplegar con marca nueva (sin dominio, sin demo) | 30–45 min |
| Despliegue completo + demo + dominio propio | 60–90 min |
| + Cargar 50 propiedades por CSV | +30–60 min |

## Si algo falla

1. `npm test` debe estar verde en local — si no, el problema es tu entorno.
2. `npx wrangler deployments list` — confirma qué versión está activa.
3. `npx wrangler rollback <version-id>` — rollback instantáneo.
4. TAKEOVER.md §5b/§5c — limpieza de datos, backup y rollback de datos.
5. DEPLOYMENT.md — smoke tests y notas de propagación (Smart Placement:
   tras un deploy espera ~60 s antes de juzgar una respuesta).

Documentación completa: `TAKEOVER.md` (transferencia), `DEPLOYMENT.md`
(operación), `SECURITY.md` (modelo de seguridad), `PRODUCT-SPEC.md` (qué
hace), `BUYER-FAQ.md` (preguntas frecuentes).
