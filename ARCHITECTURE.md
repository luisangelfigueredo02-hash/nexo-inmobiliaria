# ARCHITECTURE — NEXO

## Vista de un solo worker
NEXO es **un único Cloudflare Worker** (`nexo-inmueble`). No hay microservicios.

```
Browser/PWA
  │
  ▼
worker.js (entrypoint)
  ├── ASSETS   → public/ (home, property, mapa, comparar, ia, cuenta, admin)
  ├── DB (D1)  → properties, accounts, sessions, account_favorites, …
  ├── BUCKET_IMAGENES (R2) → imágenes (variantes -w400/-w800/-w1200)
  ├── VECTOR_INDEX (Vectorize) → embeddings del catálogo
  └── AI (Workers AI)        → chat asistente (gemma-4-26b)
```

## Módulos clave
| Módulo | Rol |
|---|---|
| `worker.js` | router, endpoints, SEO dinámico de `/property.html` |
| `session-runtime.js` | cookies `__Host-session` (04.3) |
| `src/auth/authorization/` | RBAC + ownership + serialización (04.5) |
| `src/auth/passwords.js` | PBKDF2-SHA256 (07) |
| `rate-limit.js` | rate limit D1-based (IP hash) |
| `scripts/generate-csp-hashes.mjs` | CSP hash sync (anti-drift) |
| `scripts/seed-demo.mjs` | genera demo-seed/clear (25 props, coords reales) |

## Identidad de inmuebles (04.4.1)
- `properties.id` INTEGER PK — vínculos internos/relaciones.
- `properties.public_code` TEXT UNIQUE (`N-001`) — URLs/SEO/IA/Vectorize.
- `listing_id_sequence` para generar códigos (nunca `COUNT+1`).

## Flujos principales
- **Catálogo**: `GET /api/properties` — doble barrera (SELECT público + serializer).
- **SEO detalle**: la ruta `/property.html?id=X` inyecta meta/OG/JSON-LD server-side.
- **Auth público**: `POST /api/auth/register|login` → `__Host-session`;
  `GET|PUT|DELETE /api/me/favorites`; logout vía `POST /api/session/logout`.
- **Admin**: `Bearer ADMIN_TOKEN` → CRUD, upload R2 (`/api/admin/upload-image`), CSV.
- **Media**: `GET /media/*` lee R2; negociación WebP por `Accept` con `Vary: Accept`.
- **IA**: `/api/chat` — Workers AI con catálogo real en contexto; honesto ante 0 resultados.

## Decisiones canónicas (ADRs)
001–015 en `identity-architecture-adrs.md` (identity/headers/session/authorization/
listing-identity/docs). La desviación documentada actual: **email+password PBKDF2**
sustituye al passwordless-first por ausencia de proveedor de email (07).
