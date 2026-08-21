# NEXO — LISTING IDENTITY (04.4.1) — CANONICAL MODEL

Resuelve la inconsistencia detectada en 04.4 §0.3 entre `properties.id`,
`listing_owners.listing_id` y `moderation_events.listing_id`.

**Estado**: implementado en código + migration `0005` aplicada y validada en
D1 local. **Producción NO migrada** — requiere aprobación explícita.

## 1. Modelo canónico

| Identificador | Columna | Tipo | Uso |
|---|---|---|---|
| **INTERNAL LISTING ID** | `properties.id` | INTEGER PK AUTOINCREMENT | relaciones internas, admin plane, FKs |
| **PUBLIC LISTING ID** | `properties.public_code` | TEXT NOT NULL UNIQUE | URLs, SEO, IA/chat, referencias de usuario |
| **URL IDENTIFIER** | `public_code` (`/property.html?id=N-001`) | — | numérico legacy (`?id=9`) sigue resolviendo (compatibilidad) |

Regla: el público (incluida la IA) solo conoce `public_code`. Las relaciones
internas referencian **siempre** `id` (INTEGER, sin CASTs):

```
listing_owners.listing_id    INTEGER → properties(id) ON DELETE CASCADE
moderation_events.listing_id INTEGER → (sin FK: historial audit sobrevive
                                        al borrado del listing)
favorites.property_id        INTEGER → properties(id) (legacy, vacío)
user_favorites.property_id   INTEGER → properties(id) (legacy, vacío)
analytics_events.property_id INTEGER  (legacy, sin FK)
```

## 2. public_code — propiedades garantizadas

- Único (UNIQUE constraint), NOT NULL.
- Estable: no cambia al editar la propiedad.
- Irreutilizable: generado desde `listing_id_sequence` (tabla contador,
  UPDATE+INSERT en batch atómico D1), nunca desde `COUNT()` ni `MAX(id)` —
  un DELETE no reutiliza códigos.
- Formato `N-%03d` (N-001, N-002…). Sin información interna (no sequence de
  DB, no account id, no security data). **No es un secreto**.
- Resolución dual en lectura: patrón `N-\d+` → lookup por `public_code`
  (case-insensitive, normalizado a mayúsculas); numérico → lookup por `id`
  interno. La columna se decide por patrón, nunca por CAST.

## 3. Superficies actualizadas (compatibilidad)

| Superficie | Identificador |
|---|---|
| `GET /api/properties` | devuelve `id` + `public_code` (transición; whitelist pública intacta) |
| `GET /api/properties/{ref}` | dual: public_code o id legacy |
| `GET /api/properties/{ref}/similar` | dual entrada; exclusión por id interno |
| `GET /property.html?id=` (SEO) | dual; meta/JSON-LD con datos reales |
| `/api/chat` (IA) | contexto y citas `[N-001]` = public_code; Vectorize ids = public_code |
| Admin list/edit/delete | id interno (admin plane); POST devuelve `{id, public_code}` |
| Frontend index/property/admin | links públicos usan `public_code || id` (fallback) |
| Media R2 | sin cambios: URLs `/media/n001/…` no dependen del id interno |
| Favoritos | client-side localStorage; tablas legacy vacías, sin runtime |

## 4. Migration 0005 (`migrations/0005_canonical_listing_identity.sql`)

Estrategia create→copy→validate→swap (D1/SQLite):

1. `listing_id_sequence` creada y seedeada desde `MAX(public_code)` existente.
2. `properties` rebuild con `public_code TEXT NOT NULL UNIQUE`; copia completa
   de columnas legacy (`contact_email`, `verified`, flags servicios,
   `embedding_id`, `agreed_price`, `commission`, `operation`, `created_by`);
   los 7 índices explícitos se recrean; `sqlite_sequence` conserva id=9.
3. `listing_owners` rebuild (0 filas en prod) con FK real a `properties(id)`
   ON DELETE CASCADE (ownership muere con el listing).
4. `moderation_events` rebuild (0 filas) con `listing_id INTEGER` y **sin FK**:
   el historial de moderación es audit y debe sobrevivir al borrado;
   CASCADE destructivo prohibido (04.4.1 §11).

Idempotencia razonable: `IF NOT EXISTS` en índices/sequence; la migration se
aplica una sola vez vía tracker `d1_migrations`. Rollback: backup export
completo previo (schema + rows) → re-import.

## 5. Procedimiento de producción (PENDIENTE aprobación)

```bash
# 1. Backup
npx wrangler d1 export nexo-db --remote --output=/tmp/nexo-backup-$(date +%F).sql
# 2. Snapshot de validación pre-migration
npx wrangler d1 execute nexo-db --remote --command "SELECT COUNT(*) c FROM properties"
# 3. Aplicar SOLO 0005 (tracker ya marca 0001-0004)
npx wrangler d1 migrations apply nexo-db --remote
# 4. Validación post-migration (§22): ver §6
# 5. Rollback si falla: npx wrangler d1 execute nexo-db --remote --file=<backup>
```

## 6. Validación de datos (§22) — ejecutada en local sobre clon real

| Check | Query | Resultado local |
|---|---|---|
| internal ID presente | `SELECT id FROM properties` | id=9 ✓ |
| public_id presente | `SELECT public_code FROM properties` | 'N-001' ✓ |
| unicidad | GROUP BY public_code HAVING COUNT>1 | 0 duplicados ✓ |
| UNIQUE enforce | INSERT duplicado | SQLITE_CONSTRAINT_UNIQUE ✓ |
| NOT NULL enforce | INSERT NULL | SQLITE_CONSTRAINT_NOTNULL ✓ |
| orphans listing_owners | NOT EXISTS join | 0 ✓ |
| orphans moderation_events | NOT EXISTS join | 0 ✓ |
| orphans favorites | (vacías) | 0 ✓ |
| datos preservados | id/status/price/title/images/created_at | idénticos ✓ |
| media | `/media/n001/*` JSON intacto | ✓ (sin migración física) |
| sequence | value=1 post-migration | ✓ (N-001 existente) |

## 7. Riesgos residuales

1. **Producción sin migrar**: hasta aprobar 0005 en remoto, la constraint
   NOT NULL UNIQUE no existe en prod (el código funciona igual: generación
   vía fallback MAX(public_code)+retry, o secuencia si la tabla existe).
2. **Tablas legacy duplicadas** `favorites`/`user_favorites`/`users` (vacías,
   sin uso en runtime): deuda histórica, fuera del alcance de esta fase;
   candidatas a cleanup futuro.
3. **`public_code` nullable en prod** hasta la migration: una importación
   manual sin código violaría el modelo (mitigado: código siempre genera).
4. `properties.status` sigue sin CHECK de estados completos (workflow de
   moderación completo pertenece a 04.7/04.8).
