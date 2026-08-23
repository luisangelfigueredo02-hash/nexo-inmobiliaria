# FINAL TRANSFER CHECKLIST — NEXO

Checklist operativa para la transferencia. NINGÚN secreto real aparece en
este documento: solo nombres de variables y procedimientos.

---

## SELLER ACTIONS (vendedor)

### Antes del pago
- [ ] Mantener producción actual operativa con `DEMO_MODE=1` para demos.
- [ ] Preparar export opcional de D1: `npx wrangler d1 export nexo-db --remote --output=backup-<fecha>.sql` (guardar FUERA del repo).
- [ ] Preparar export opcional de objetos R2 (imágenes demo + N-001).
- [ ] Decidir si `analisis_competencia_nexo.md` se incluye o se retira del repo.
- [ ] Decidir destino de N-001 (única propiedad real) en la entrega.

### En la transferencia
- [ ] GitHub: Settings → Transfer ownership al comprador (o entregar fork/zip). Incluye: código, migrations, scripts, docs, reportes de auditoría, LICENSE MIT, CHANGELOG.
- [ ] Revisar/desactivar GitHub Pages del repo propio (activo en la cuenta del vendedor).
- [ ] Entregar exports D1/R2 por canal seguro si el comprador los adquirió.

### Después de la transferencia
- [ ] Rotar tokens personales del entorno de desarrollo (`~/.cf_token`, `~/.gh_token`) — recomendado desde Gate 19, UNKNOWN si ejecutado.
- [ ] Revocar cualquier acceso del comprador a la cuenta Cloudflare del vendedor.
- [ ] Decidir cuándo apagar el deployment del vendedor (coordinar con el comprador para no cortar la demo acordada).
- [ ] Si el comprador lo solicita: actualizar el copyright de LICENSE (MIT lo permite).

## BUYER ACTIONS (comprador)

### Infraestructura Cloudflare (cuenta propia)
- [ ] Crear worker (deploy desde el repo), D1 `nexo-db`, R2 `nexo-media`, Vectorize `nexo-index` (768 dims, cosine) — comandos exactos en BUYER-QUICKSTART.md §3.
- [ ] Actualizar `database_id` en `wrangler.toml` con el ID de SU D1.
- [ ] Inicializar D1: `schema.sql` primero, luego `node scripts/apply-migrations.mjs --remote` (NUNCA `wrangler d1 migrations apply`).
- [ ] Workers AI: sin configuración (binding `[ai]` ya declarado).

### Configuración
- [ ] Editar `wrangler.toml [vars]`: `BRAND_*`, `WHATSAPP_PHONE`, `CONTACT_*`, `SOCIAL_*`, `MARKET_*`, `DEFAULT_CURRENCY`, `MAP_CENTER_*`.
- [ ] `DEMO_MODE`: `"1"` mientras use el inventario demo; `"0"` al cargar inventario real.
- [ ] Secreto: `npx wrangler secret put ADMIN_TOKEN` (valor nuevo propio — el del vendedor jamás se comparte).
- [ ] GitHub Secrets del repo transferido: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` propios (para CI/CD).

### Dominio (opcional)
- [ ] Custom Domain en Cloudflare (Settings → Domains & Routes). Sitemap/robots/manifest se adaptan solos (origin dinámico).

### Datos
- [ ] Opción A — empezar limpio: nada que importar; catálogo vacío con empty states ya diseñados.
- [ ] Opción B — demo: `node scripts/seed-demo.mjs` + execute `demo-seed.sql`.
- [ ] Opción C — inventario del vendedor: importar el export D1 entregado + subir imágenes R2 entregadas.
- [ ] Cargar inventario real: admin UI, CSV import o API.

### Verificación final (BUYER-QUICKSTART §9 / TAKEOVER §8)
- [ ] `/api/health` → ok
- [ ] `/api/config` → muestra LA MARCA DEL COMPRADOR
- [ ] `npm test` → 249 verdes
- [ ] `/admin` con el nuevo ADMIN_TOKEN: crear/editar/eliminar una propiedad de prueba y borrarla
- [ ] Registro de cuenta + favorito + logout en el sitio público

## JOINT ACTIONS (ambas partes)

- [ ] Acordar fecha de corte: hasta cuándo la demo del vendedor permanece activa.
- [ ] Acordar si se incluye el inventario actual (demo + N-001) y su export.
- [ ] Confirmar canal de entrega de exports (nunca por medios públicos; los backups contienen datos y NO van al repo).
- [ ] Confirmar en escritura que NO se transfieren: cuentas personales, tokens personales, secretos personales, la cuenta GitHub del vendedor, la cuenta Cloudflare del vendedor.
- [ ] (Recomendado) Videollamada de handoff de 30–45 min recorriendo BUYER-QUICKSTART.md en vivo.

## Servicios de terceros (estado en la transferencia)

| Servicio | ¿Se transfiere? | Nota |
|---|---|---|
| Cloudflare Workers/D1/R2/Vectorize/AI | NO (cuenta del vendedor) | El comprador crea los suyos (guía incluida) |
| GitHub repo | SÍ (Transfer o fork) | Pages del vendedor se revisa/desactiva |
| Dominio | NO | No hay dominio propio; `*.workers.dev` no es transferible |
| ADMIN_TOKEN | NO | El comprador genera el suyo |
| Sentry | N/A | DSN vacío; el comprador puede configurar el suyo |
| Analytics | N/A | No hay analytics implementado |
| Email provider | N/A | No hay; lo necesitaría recovery de contraseña |
