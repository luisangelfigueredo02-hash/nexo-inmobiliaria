# DEPLOYMENT — NEXO

Despliegue, rollback y migraciones del worker único `nexo-inmueble`.

## Requisitos
- Node ≥ 18, `npm install`
- Credenciales Cloudflare: `npx wrangler login` **o** `export CLOUDFLARE_API_TOKEN=…`
  (GitHub Actions usa el secret `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`)

## Deploy
```bash
npx wrangler deploy
```
CI/CD: push a `main` ejecuta `.github/workflows/deploy.yml` (quality gates → deploy).

## Variables y secretos
- `[vars]` en `wrangler.toml`: marcas, contacto, mercado, mapa, `DEMO_MODE`.
- Secretos (nunca en toml): `npx wrangler secret put ADMIN_TOKEN`, `SENTRY_DSN`, …

## Migraciones D1

Usa SIEMPRE `scripts/apply-migrations.mjs` (no `wrangler d1 migrations
apply`): `schema.sql` ya incluye `properties.currency`, por lo que el ALTER
crudo de la migration 0007 fallaría por columna duplicada en una D1 nueva;
el script lo aplica de forma idempotente y reconcilia el tracker
`d1_migrations` sin borrar entradas históricas.

```bash
# Local (schema base PRIMERO — crea `properties`; la migration 0002 hace
# ALTER sobre ella y fallaría sin este paso)
npx wrangler d1 execute nexo-db --local --file=schema.sql
node scripts/apply-migrations.mjs --local

# D1 nueva (producción del comprador): mismo orden
npx wrangler d1 execute nexo-db --remote --file=schema.sql
node scripts/apply-migrations.mjs --remote

# D1 actual de producción (tracker reconciliado 0001–0007 + histórica
# 0006_properties_currency): ya está aplicada; el script es no-op idempotente
node scripts/apply-migrations.mjs --remote
```

## Rollback
Cloudflare conserva cada versión desplegada:
```bash
npx wrangler deployments list        # ver versiones
npx wrangler versions view <id>      # inspeccionar
# Rollback inmediato (redirige todo el tráfico a la versión indicada):
npx wrangler rollback <version-id>
# (o desplegar de nuevo el commit anterior desde git)
```
En la práctica: `git revert` + `npx wrangler deploy` es el camino recomendado.

## Smoke test post-deploy
```bash
curl -s https://<dominio>/api/health
curl -s https://<dominio>/api/config | head
curl -s -o /dev/null -w '%{http_code}\n' https://<dominio>/
```

## Notas de agotamiento
- **Assets**: `public/` servido vía `[assets]`; `run_worker_first = true`.
- **Smart Placement** activo: tras un deploy, durante unos minutos algunos
  colos pueden servir la versión previa (fue la causa de respuestas mixtas
  en el gate de white-label). Espera ~60s y reintenta en smoketests.
- **CSP**: tras tocar scripts inline en `public/`:
  `node scripts/generate-csp-hashes.mjs --write` (el test anti-drift falla si no).
