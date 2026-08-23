# BUYER VALUE — NEXO

## REPLACEMENT-COST ESTIMATE

> Esto es una **estimación de coste de reemplazo** (lo que costaría a un
> equipo profesional construir algo equivalente desde cero). NO es una
> tasación de mercado ni una promesa de valor de reventa. No incluye datos
> de transacciones de mercado porque no los tenemos.

Supuestos: equipo senior (tech lead + full-stack + diseñador UX/UI),
alcance exactamente equivalente al producto verificado en producción,
sin contar las iteraciones de auditoría (21 gates) que llevaron al estado
actual.

| Componente | Horas LOW | Horas MID | Horas HIGH |
|---|---|---|---|
| UX/UI (research, design system, mobile-first) | 60 | 100 | 160 |
| Frontend (6 páginas públicas + admin) | 120 | 180 | 260 |
| Backend/API (routing, validación, REST) | 60 | 100 | 150 |
| Authentication (sesiones, PBKDF2, CSRF, CORS) | 30 | 50 | 80 |
| Authorization (RBAC + ownership + serializers) | 30 | 50 | 80 |
| D1 (esquema, 7 migrations, reconciliación) | 16 | 30 | 50 |
| R2 media (upload, WebP, cache, traversal) | 16 | 25 | 40 |
| Integración IA (chat + contexto catálogo + Vectorize) | 20 | 35 | 60 |
| Mapa (Leaflet, markers precio, estados) | 16 | 25 | 40 |
| PWA (SW, manifest dinámico, offline) | 16 | 30 | 50 |
| SEO (meta/OG/JSON-LD, sitemap/robots dinámicos) | 10 | 16 | 25 |
| Seguridad (CSP hash, rate-limit, baterías) | 30 | 50 | 80 |
| Admin (CRUD, galería, mapa clic, CSV) | 30 | 50 | 80 |
| CSV import/export | incl. arriba | incl. arriba | incl. arriba |
| White-label (tokens, manifest dinámico, robots/sitemap por origin) | 20 | 35 | 55 |
| CI/CD + deploy Cloudflare | 12 | 20 | 35 |
| Testing (249 tests, 15 suites) | 40 | 70 | 110 |
| Documentación (takeover, security, spec, quickstart) | 30 | 50 | 80 |
| **TOTAL** | **~556 h** | **~906 h** | **~1.475 h** |

### Coste de reemplazo en dinero

| Tarifa | LOW (556 h) | MID (906 h) | HIGH (1.475 h) |
|---|---|---|---|
| $40/h | $22.2k | $36.2k | $59.0k |
| $60/h | $33.4k | $54.4k | $88.5k |
| $80/h | $44.5k | $72.5k | $118.0k |

**Rango razonable de referencia: $35k–$70k** (ESTIMATED).

## Qué compra el comprador (VERIFIED)

1. Código production-ready con 249 tests verdes y CI/CD funcionando.
2. Arquitectura Cloudflare completa: Workers + D1 + R2 + Vectorize + AI.
3. UX/UI premium mobile-first ya construida y auditada (3 gates visuales).
4. White-label real: rebrand completo por variables de entorno.
5. Auth pública + autorización RBAC/ownership auditadas adversarialmente.
6. Panel admin operativo con imágenes R2 y CSV.
7. Documentación de transferencia que permite takeover sin el vendedor.
8. Historial de 21 gates de auditoría con evidencia clasificada.
9. Licencia MIT: el comprador puede usar, modificar y revender.
10. Inventario demo reproducible para ventas/demos inmediatas.

## Qué NO compra (VERIFIED)

- Revenue (0), usuarios (0), tráfico (no demostrado).
- Inventario comercial (1 propiedad real de desarrollo).
- Dominio propio ni marca con tracción.
- Clientes, contratos, ni pipeline comercial.

## Cómo usar esta estimación en la negociación

El replacement-cost responde a la pregunta del comprador: *"¿por qué no lo
construyo yo?"* — porque construirlo cuesta 5–15× el precio de compra y
3–6 meses de calendario. El precio de venta NO se deriva de este número:
se deriva de lo que un activo de software sin tracción vale para el
comprador concreto (ver MARKETPLACE-LISTING.md y Gate 21 §14–18).

## Posición de precio (baseline Gate 21, sin cambios)

| Concepto | Valor |
|---|---|
| Asking price (publicación) | $7.500 |
| Expected close | $4.000–6.000 |
| Negotiation floor | $3.500 |
| Quick-sale | $2.500–3.500 |
| Strategic buyer | $10.000–15.000 |

Todos ESTIMATED. El objetivo del paquete es que el comprador entienda el
valor de reemplazo y decida; no convencerlo de una cifra.
