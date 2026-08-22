# NEXO — TAKEOVER

Guía operativa construida exclusivamente sobre evidencia verificada (NEXO 05.3 → 05.5). Cada afirmación tiene una etiqueta: **VERIFIED** (confirmado por API/HTTP), **RECOVERED** (extraído de producción), **RECONSTRUCTED** (derivado del bundle), o **UNKNOWN** (sin evidencia).

## 1. Arquitectura (VERIFIED)

Worker único `nexo-inmueble` en Cloudflare; entrypoint ES module con handler `fetch`. Bindings: D1, R2, Vectorize, Workers AI, Assets. Sin `scheduled`/queue/cron en el bundle. Smart Placement activo, `compatibility_date: 2026-08-19`, logpush off. Routing por `url.pathname` + método HTTP dentro de `worker.js`. Headers de seguridad con CSP hash-based (9 hashes) aplicados a toda respuesta.

## 2. Cloudflare resources (VERIFIED — script-settings.json + wrangler.toml)

| Tipo | Nombre / recurso |
|---|---|
| Worker | `nexo-inmueble` en account `8816663cf4f1768c51859f07ab8305f4` |
| D1 | `nexo-db` (`03a0f232-751a-4d5b-a865-473062fbefbe`) |
| R2 | `nexo-media` |
| Vectorize | `nexo-index` |
| Workers AI | binding por catálogo |
| Assets | contenido de `public/` |
| Version actual | `d5a61b95-5f33-41b2-b2c3-317da62ec872` (script_tag `ca01d3f579e042e9860cee807e6e8430`) |

URL producción: `https://nexo-inmueble.luisangelfigueredo02.workers.dev`.

## 3. D1 (VERIFIED — schema leído read-only + parity)

- Migraciones aplicadas: 0001 → 0006 (tracker `d1_migrations`).
- `0006_properties_currency.sql` existe **solo** en producción (añade `currency TEXT`); su fichero no está en repo. Documentación en `recovery/notes/0006_properties_currency.sql` (no aplicable).
- Parity por tabla:
  - PARITY: `accounts`, `audit_events`, `listing_id_sequence`, `listing_owners`, `moderation_events`, `profiles`, `roles`, `sessions`, `user_roles`
  - DIFF: `properties` → producción añade `currency`
  - PRODUCTION-ONLY: `analytics_counters`, `analytics_events`, `favorites`, `ia_events`, `ia_feedback`, `ia_sessions`, `user_favorites`, `users` (legacy sin uso), `rate_limits` (creada en runtime por `rate-limit.js` — comportamiento intencional)
  - Índices repo-only: `idx_accounts_status`, `idx_user_roles_account_id` (dropeados por rebuild de 0003 — previsto)
- Extracto DDL: `recovery/production-d5a61b95/worker/metadata/prod-full-schema.sql`.

## 4. R2 (VERIFIED)

Binding `BUCKET_IMAGENES → nexo-media`. `/media/*` con negociación WebP por ancho (`-w400/-w800/-w1200`) y fallback al objeto original; etag + Cache-Control immutable; HEAD soportado.

## 5. Vectorize (VERIFIED)

Binding real: `VECTOR_INDEX → nexo-index`. HEAD (`24e0982`) usaba `env.VECTORIZE` (roto en producción). Sincronización de índice en admin POST/PUT/DELETE y búsqueda en `/api/chat`. **Vector ids = `public_code` (04.4.1), nunca PK interna.**

## 6. Workers AI (VERIFIED)

Modelo: `@cf/google/gemma-4-26b-a4b-it` (llama-3 deprecated causaba 500). Producción usa `extractAiText` con fallbacks `response → choices[0].message.content → result → text`.

## 7. Bindings (VERIFIED)

`ADMIN_TOKEN`, `ADMIN_PASSWORD` (legacy, deprecar), `AI`, `ASSETS`, `BUCKET_IMAGENES`, `DB`, `SENTRY_DSN` (plain, vacío/fail-open), `VECTOR_INDEX`, `WHATSAPP_PHONE` (plain `+5358385702`, público). CORS allowlist: `url.origin` + `http://127.0.0.1:8787`; credenciales solo en `/api/session/*` (cache `no-store`).

## 8. Secrets que deben rotarse (RECOVERED)

- `~/.cf_token` (Cloudflare token expuesto público per AGENTS.md) → ROTAR
- `~/.gh_token` (GitHub token expuesto) → ROTAR
- `ADMIN_PASSWORD` (legacy) → eliminar o rotar en fase autorizada

Los valores reales no se recuperaron (solo nombres de bindings) → **UNKNOWN**. Audits no detectaron secrets en el código recuperado (ver `reports/05.5-SECURITY-AUDIT.md`).

## 9. Deploy procedure (RECONSTRUCTED)

1. Branch limpio (`git status` vacío). NO deploy desde working tree sucio.
2. `npm ci`; `npm test` → 188/188 PASS.
3. `node scripts/generate-csp-hashes.mjs --write` si `public/` cambió (worker-integrity guard).
4. `npx wrangler deploy` (desde commit determinado).
5. Post-deploy: `curl https://nexo-inmueble.<account>.workers.dev/api/health` → `200 {ok:true, timestamp}` + endpoints críticos (admin con credenciales).

## 10. Rollback (RECOVERED)

Cloudflare: `wrangler versions list` → elegir version previa → swap vía Dashboard/API. Relación version/SHA en el manifest (`reports/05.5-CANONICAL-SOURCE-MANIFEST.md`). D1/R2/Vectorize no requieren mutación adicional en un rollback de código.

## 11. Git workflow obligatorio (RECONSTRUCTED)

- Trunk = `main`. Deploy solo desde commits pushados.
- La rama recovery se preserva en `recovery/nexo-production-2026-08-22` (no pushed).
- Prohibido deploy desde working tree sucio salvo emergencia documentada.

## 12. Cómo cambiar mercado (RECONSTRUCTED)

`MARKET_CONFIG` en `worker.js` (env-override de `market_country`, `market_locale`, `default_currency`, `map_center`, `map_zoom`, `WHATSAPP_PHONE`). Además: allowlist `ALLOWED_CURRENCIES` (USD/EUR/CUP), SEO (`es_CU`, `addressCountry:'CU'`) y assets branding. Update tests antes de deploy.

## 13. Cómo verificar producción (VERIFIED)

- `/api/health` → `{ok:true, timestamp}` (`no-store`).
- Tracker: `SELECT name, applied_at FROM d1_migrations ORDER BY applied_at`.
- Version tracking: `wrangler versions list` + check `etag`/script_tag.
- CSP: `node scripts/generate-csp-hashes.mjs` tras editar `public/`.

## 14. Cómo recuperar una versión (RECOVERED)

1. `GET /accounts/<account_id>/workers/scripts/nexo-inmueble` → multipart (módulos + metadata).
2. Registrar `etag`, `script_tag`, `created_on`, bindings, `version_id`.
3. Calcular SHA-256 de los streams; guardar en la rama recovery con manifest.
4. Proceso documénted en `recovery/production-d5a61b95/worker/hashes/manifest.txt`.

## 15. Buyer handover checklist (RECONSTRUCTED)

- Account ID, worker name, bindings, recursos (sección 2)
- Secrets a rotar (sección 8)
- `ADMIN_PASSWORD` legacy → eliminación pendiente
- Smoke mínimo: `/api/health`, `/api/config`, `/api/properties`, `/property.html?id=`, `/sitemap.xml`, `/media/*` (R2), admin login, `/api/chat`
