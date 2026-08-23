# FINAL GATE 20 — BASELINE (Fase 20A)

**Fecha:** 2026-08-23 · **Modo:** read-only durante la captura
**Producción:** https://nexo-inmueble.luisangelfigueredo02.workers.dev

Clasificación: **VERIFIED** (observado directamente) · **INFERRED** · **ESTIMATED** · **UNKNOWN**.

---

## 1. Git / repositorio

| Ítem | Valor | Clasificación |
|---|---|---|
| HEAD al iniciar Gate 20 | `7e4e420` "GATE 19: sale-readiness certification report" | VERIFIED |
| origin/main | `7e4e420` (sincronizado, working tree limpio) | VERIFIED |
| Clone | shallow (grafted) | VERIFIED |
| Repo | `luisangelfigueredo02-hash/nexo-inmobiliaria` — **público**, cuenta personal | VERIFIED |
| GitHub Pages | workflow `pages-build-deployment` activo en cada push | VERIFIED |

## 2. CI/CD

| Ítem | Valor | Clasificación |
|---|---|---|
| Workflow | `.github/workflows/deploy.yml` (quality-audit → deploy) | VERIFIED |
| Últimos runs pre-Gate-20 | 3/3 `success` (Gate 19) | VERIFIED |
| Secrets CI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (no legibles, existencia inferida por runs exitosos) | INFERRED |
| Permisos token GitHub | `GITHUB_TOKEN` read-only; `GITHUB_API_KEY` con escritura (push verificado en este Gate) | VERIFIED |

## 3. Cloudflare

| Ítem | Valor | Clasificación |
|---|---|---|
| Worker | `nexo-inmueble`, Smart Placement, assets `public/` | VERIFIED (wrangler.toml + comportamiento) |
| Deployment pre-Gate-20 | 2026-08-23T14:17:53Z, version `ceb33f2a-0f59-4c5b-9b34-8b161ca54085` | VERIFIED |
| Deployment post-Gate-20 | 2026-08-23T20:33:06Z, version `c8b3a658-db8a-4467-ac51-222a193d283d` | VERIFIED (API Cloudflare directa) |
| Cuenta | `8816663cf4f1768c51859f07ab8305f4` (subdomain personal `luisangelfigueredo02`) | VERIFIED |
| Secrets del worker | solo `ADMIN_TOKEN` | VERIFIED (`wrangler secret list`) |
| Vars | `WHATSAPP_PHONE` (número del operador), `DEMO_MODE=1`, `SENTRY_DSN=""` | VERIFIED (wrangler.toml + /api/config) |

## 4. D1

| Ítem | Valor | Clasificación |
|---|---|---|
| DB | `nexo-db` (`03a0f232-751a-4d5b-a865-473062fbefbe`) | VERIFIED |
| Tracker | 8 entradas: 0001–0005, `0006_properties_currency` (histórica no versionada), `0006_public_user_auth`, `0007_schema_reconciliation` | VERIFIED |
| `wrangler d1 migrations list --remote` | "No migrations to apply" (los 7 archivos del repo aplicados) | VERIFIED |
| Propiedades | 26 (25 demo `D-*` + 1 real `N-001`) | VERIFIED |
| Cuentas pre-Gate-20 | 2 (1 activa con email personal del propietario, 1 anonimizada en Gate 19) | VERIFIED |
| Cuentas post-Gate-20 | 0 activas; todas anonimizadas patrón ADR-008; 0 sesiones; 0 favoritos | VERIFIED |
| Backup pre-sanitización | `/tmp/nexo-backup-gate20.sql` (fuera del repo) | VERIFIED |

## 5. R2 / Vectorize / Workers AI

| Ítem | Valor | Clasificación |
|---|---|---|
| R2 `nexo-media` | binding operativo: `/media/n001/photo-01.jpg` → 200 `image/jpeg`; WebP bajo `Accept: image/webp`; `Vary: Accept`; `immutable` | VERIFIED |
| R2 API (`wrangler r2 bucket list`) | error 10042 "Please enable R2 through the Cloudflare Dashboard" con el token actual | VERIFIED (el error); UNKNOWN (causa: scope del token vs. configuración de cuenta; el bucket funciona en producción) |
| Vectorize `nexo-index` | existe, 768 dims, cosine, creado 2026-08-19 | VERIFIED |
| % de listings indexados | sin endpoint de conteo; chat funciona por fallback de catálogo | UNKNOWN |
| Workers AI | modelo `@cf/google/gemma-4-26b-a4b-it` responde en `/api/chat` con inventario real | VERIFIED |

## 6. Tests / sintaxis

| Ítem | Valor | Clasificación |
|---|---|---|
| Suite local pre-Gate-20 | 249/249 | VERIFIED |
| Suite post-fixes Gate 20 | 249/249 | VERIFIED |
| `node --check worker.js` | OK | VERIFIED |
| Hashes CSP | 12, regenerados tras tocar scripts inline (`generate-csp-hashes.mjs --write`) | VERIFIED |

## 7. Producción (smoke pre-fixes)

15/15 rutas → 200 (`/admin.html` → 307 → `/admin` → 200). TTFB `/` ≈ 0.10–0.24 s, gzip, `cf-cache-status: HIT`. Seguridad: admin 401/401, IDOR 404, SQLi 200/0 filas, traversal 400, register sin email 400, chat oversize 400, HSTS+CSP hash-based+permissions-policy presentes. Todo VERIFIED.

## 8. Hallazgos del baseline que derivaron en fixes (20W)

1. `public/robots.txt` hardcodeaba la URL personal `…luisangelfigueredo02.workers.dev` → P1 white-label.
2. `src/brand.js` `DEFAULTS.whatsapp` embebía el teléfono personal como fallback → P1 datos personales.
3. Manifest dinámico referenciaba `/icons/icon-512-maskable.png` → 404 → P2.
4. `public/manifest.json` estático = código muerto (worker sirve el manifest dinámico) → REMOVE.
5. README desactualizado (endpoints inexistentes, `ADMIN_PASSWORD`, "15 pruebas") → P1 documentación.
6. Cuenta personal activa del propietario en D1 producción → P1 datos personales.
