# IDENTITY-DATABASE — 04.1 Foundation

Base de datos de identidad para Nexo, implementando 04.0. Solo-schema,
sin authentication/session behavior (eso pertenece a 04.2/04.3).

---

## SCHEMA TABLES

- **accounts** — entidad principal de identidad. PK: `id` TEXT (ULID/randomUUID
  al alta). UNIQUE(email), CHECK(status), deletion_state ADR-008.
  Nota: `security_stamp` TEXT cambia en password change/session-revoke.

- **profiles** — separación (04.0 #6). 1:1 con accounts.pk.
  display_name, avatar_url (R2), bio, city, language, agent_verificationmarkers,
  contact_preferences JSON. PII opcional, nunca api pública.

- **roles** (`MODERATOR`,`ADMIN`,`SUPERADMIN`,`AGENCY`): catálogo estable.
  NO ownership por roles. Seedeable con `INSERT OR IGNORE`.

- **user_roles** — composite PK (account_id, role) UNIQUE; granted_by,
  granted_at, revoked_at temporal.

- **sessions** — data structure only. account_id FK; token_hash (nunca plaintext);
  device_label, user_agent, ip_subset; expires_at; revoked_at; last_seen_at.
  Índices: `(account_id)`, `(expires_at)`.

- **listing_owners** — ownership explícito ∩ identity: (listing_id, account_id,
  relationship IN owner|agent|managed_by), PK composite, opcional revoked_at.
  Developer/admin role no se asume.

- **moderation_events** — state transition events IMMUTABLE:
  (listing_id, actor_id REFS accounts, previous_state, new_state, reason,
  request_correlation_id). Índices por listing/actor/created_at.

- **audit_events** — append-only conceptual. actor_id nullable REFS accounts;
  actor_type user|anonymous|system; action; resource_type+id; metadata JSON
  no-secrets; correlation_id; índices por actor/action/correlation/created_at.

---

## CONSTRAINTS / FOREIGN KEYS

Todos con `PRAGMA foreign_keys = ON` (Worker setup) y `ON DELETE RESTRICT`
onde aplica (no CASCADE vs audit; restrict en profiles/user_roles/listing_owners/sessions).

- `profiles.account_id` → `accounts(id)` RESTRICT (no orphan profile).
- `user_roles(account_id, role)` → `(accounts(id), roles(name))` RESTRICT.
- `sessions.account_id` → `accounts(id)` RESTRICT.
- `listing_owners.account_id` → `accounts(id)` RESTRICT.
- `audit_events.actor_id` → `accounts(id)` RESTRICT.
- `moderation_events.actor_id` → `accounts(id)` RESTRICT.
- `properties.created_by` → `accounts(id)` (migration-0002; backward-compat).

---

## INDEXES (access pattern-driven)

- `accounts(status)` — filter available accounts.
- `profiles(language)` — i18n lookup.
- `sessions(account_id)`, `sessions(expires_at)` — lookup current/expired.
- `user_roles(account_id)` — permission hierarchy.
- `listing_owners(account_id)` — account→listings.
- `moderation_events(listing|actor|created_at)` — moderation timeline.
- `properties(created_by)` — ownership-aware (post 04.2).
- `audit_events(actor|action|correlation|created_at)` — searchable.

## UNIQUE CONSTRAINTS

- `accounts(email) UNIQUE` (case-normalized por Worker `lower()`).
- `accounts(phone) UNIQUE NULL` (nullable, ambiguo).
- `user_roles(account_id, role)` composite PK.
- `listing_owners(listing_id, account_id)` composite PK.

## MIGRATION PLAN

- `migrations/0001_identity_foundation.sql` — schema-only, idempotent.
  `CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`.
- `migrations/0002_properties_created_by.sql` — `ALTER TABLE properties ADD
  COLUMN created_by REFS accounts(id)` safely additive + 1 index.

WRANGER apply: `wrangler d1 execute nexo-db --remote --file migrations/0001_....`
(`--file` determinate: lee y aplica exactamente el archivo, no hay runner
interno en este repo; doc + apply explícitos en DEPLOY/production).

## PRIVACY CLASSIFICATION (04.0 #12)

| Clase | Campos | Exposición |
|---|---|---|
| PUBLIC | display_name, avatar_url, bio, city | API requerida, SEO, IA |
| PRIVATE | email (account), phone (account), address exact | sólo owner, admin con reason |
| SECURITY | password_hash, security_stamp, session tokens/hash | internal only |
| ADMIN | moderation_events.reason, audit_events.metadata | admin/moderator con scope |
| LEGACY | properties.owner_name/owner_phone/contact_email | legacy fieldwise, not identity-driven |

Los primeros 4 classes se preservan para 04.2-04.4 con oídos-by-reservations.

## AUTH IMPLEMENTATION CONFLICTS

NONE. Solo schema foundation. `auth/signup/login/logout` y `session middleware`
todavía **none**. Recovering esto en 04.2+.

## OPEN RISKS

- Legacy `users`/`favorites`/`user_favorites` en D1 remoto: vacíos (0 rows).
  No se borran; discard-safe para 04.2 dedupe o delete.
- `properties.id INTEGER` prevalece — `listing_owners.listing_id` TEXT
  es CAST-compat; el join eventual puede hacerse con `CAST(properties.id AS TEXT)`.
- `created_by` null en propiedades legacy hasta que se vinculen.
