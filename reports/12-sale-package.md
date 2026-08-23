# FASE 12 — Sale package

## Documentos entregados (VERIFIED en repo)
- `README.md` — visión, arquitectura, quickstart.
- `TAKEOVER.md` — transferencia completa (rebrand, deploy, D1, demo, admin, secretos).
- `LICENSE` — MIT.
- `CHANGELOG.md` — historial de productization.
- `DEPLOYMENT.md` — deploy/rollback/migrations/smoketests (nuevo en esta misión).
- `SECURITY.md` — modelo de auth, headers, privacidad (nuevo).
- `ARCHITECTURE.md` — mapa del worker, módulos, ADRs (nuevo).
- `reports/06..12-*` — evidencia por fase.

## DEMO MODE (VERIFIED)
- `scripts/seed-demo.mjs` → `demo-seed.sql` (25 propiedades con coords reales
  de Cuba; internal_notes='DEMO'; public_code D-XXX) y `--clear` → `demo-clear.sql`.
- `DEMO_MODE=1` → banner "Modo demostración" en la UI.
- Los `.sql` no se versionan (generados on-demand).

## Gate final — checklist de producción
| Ítem | Estado |
|---|---|
| Home / Search / Filters | ✅ VERIFIED |
| Property detail + Gallery + Images | ✅ VERIFIED |
| Map | ✅ VERIFIED |
| Compare | ✅ VERIFIED (página existente) |
| IA | ✅ VERIFIED (sin alucinación) |
| Registration / Login / Logout / Favorites | ✅ VERIFIED (prod + navegador) |
| Admin + Upload + CSV | ✅ VERIFIED |
| Demo mode | ✅ VERIFIED |
| PWA / Offline shell | ✅ VERIFIED / PARTIAL |
| SEO / Sitemap / Robots | ✅ VERIFIED |
| Security headers / CSP / AuthN / AuthZ | ✅ VERIFIED |
| White-label | ✅ VERIFIED (gate con revert) |
| Mobile viewport | ⚠️ ESTIMATED (sin device real) |
| Safari | ⚠️ UNKNOWN |

## Tests
`npm test` → **202/202 verde**; `node --check worker.js` limpio; CSP en sync (12 hashes).

## P0/P1 pendientes
- **P0: 0**. **P1: 1** — recuperación de cuenta imposible sin email provider
  (requiere decisión del comprador: Resend/SendGrid/MailChannels o restricción
  documentada). No bloquea registro/login/favoritos.

## Riesgos restantes (P2)
- Transitorio de propagación post-deploy (Smart Placement) en smoketests.
- Literales de marca "NEXO" en markup (documentado en TAKEOVER.md).
- Password reset absent (ver P1).
