# TECHNICAL ARCHITECTURE SUMMARY — NEXO

Resumen de arquitectura para evaluación técnica de compradores. Detalle
completo en `ARCHITECTURE.md`, `AUTHORIZATION.md`, `SESSION-RUNTIME.md` y
los ADRs (`identity-architecture-adrs.md`).

---

## Vista de alto nivel

```
USUARIO (browser / PWA instalada)
   │
   ▼
Cloudflare Edge (300+ ubicaciones, Smart Placement)
   │
   ▼
worker.js — UN único Cloudflare Worker
   ├── Assets estáticos (public/)        → HTML/CSS/JS, Leaflet vendored
   ├── Transformación white-label        → tokens {{BRAND_*}} por marca
   ├── SEO server-side                   → meta/OG/JSON-LD, sitemap, robots, manifest
   ├── API REST                          → catálogo, auth, favoritos, chat, admin
   ├── Seguridad                         → CSP hash-based, rate limit, authZ
   │
   ├──► D1 (SQLite serverless)      → properties, accounts, sessions, favorites
   ├──► R2 (object storage)         → imágenes con negociación WebP
   ├──► Vectorize                   → embeddings del catálogo (búsqueda IA)
   └──► Workers AI                  → asistente de búsqueda (gemma)
```

## Decisiones de arquitectura y por qué importan

**1. Un solo worker, cero microservicios.**
Toda la lógica (routing, API, SEO, seguridad, white-label) vive en un
entrypoint auditable de punta a punta. Resultado: despliegue atómico,
rollback instantáneo (`wrangler rollback`), y una sola superficie que
revisar en due diligence.

**2. Edge-first = coste operativo mínimo.**
No hay servidores, contenedores ni VMs que mantener. Cloudflare cobra por
requests; con el plan gratuito el producto funciona para desarrollo y demos,
y Workers Paid (~$5/mes) cubre producción inicial. D1, R2, Vectorize y
Workers AI tienen capas gratuitas generosas. Coste marginal por usuario:
prácticamente cero hasta volúmenes significativos.

**3. Sin framework frontend pesado.**
HTML/CSS/JS modular con un design system propio (`variables.css`). Sin build
step, sin node_modules en producción, home de ~17 KB gzip. Ventaja directa
en mobile (el mercado objetivo es mobile-first) y en mantenibilidad: cualquier
desarrollador lee el código sin aprender un meta-framework.

**4. Control server-side donde importa.**
- SEO de fichas: meta/OG/JSON-LD inyectados por el worker.
- Marca: los `{{BRAND_*}}` se sustituyen en el edge — rebrand = variables de
  entorno + redeploy, sin tocar un solo archivo.
- Seguridad: la autorización se decide server-side en cada request
  (`authorize()` deny-by-default); el cliente nunca decide permisos.

**5. Seguridad como arquitectura, no como parche.**
CSP hash-based sin `unsafe-inline` en scripts, sesiones con hash SHA-256 en
D1 (nunca tokens en claro), PBKDF2-SHA256 100k, rate limiting por alcance,
serialización whitelist por audiencia (doble barrera contra leaks de PII),
404 indistinguible anti-IDOR, CSRF por Origin. Verificado con baterías
adversariales en vivo (Gates 19–21).

**6. Datos con identidad canónica.**
`properties.id` (INTEGER, interno) + `public_code` (`N-XXX`, público) —
URLs estables, anti-enumeración, migraciones reconciliadas con aplicador
idempotente propio (`scripts/apply-migrations.mjs`).

## Stack completo

| Capa | Tecnología |
|---|---|
| Compute | Cloudflare Workers (Smart Placement) |
| Assets | Workers Static Assets (`public/`) |
| DB | Cloudflare D1 (SQLite) — 21 tablas, 7 migrations |
| Media | Cloudflare R2 — WebP negotiation, immutable cache |
| Search/AI | Vectorize (768/cosine) + Workers AI (gemma) |
| Mapa | Leaflet (self-hosted + fallback) + OSM/CARTO tiles |
| Auth | Cookie `__Host-session` + PBKDF2 (público); Bearer token (admin) |
| CI/CD | GitHub Actions → tests (249) → wrangler deploy |
| Licencia | MIT |

## Riesgos técnicos conocidos (honestidad)

- Vendor lock-in de Cloudflare: la arquitectura es Cloudflare-nativa por
  diseño; migrar a otro proveedor es un proyecto, no una configuración.
- Single-tenant por instancia: una marca por despliegue.
- Vectorize es auxiliar: el chat funciona sin índice (fallback de catálogo).
- Escalado de markers en mapa: clustering no implementado (backlog, >100
  listings).
