# FASE 11 — White-label

## Config central (wrangler.toml [vars] → env → /api/config + SEO dinámico)

BRAND_NAME · BRAND_DESCRIPTION · BRAND_TAGLINE · BRAND_THEME_COLOR ·
BRAND_LOGO · WHATSAPP_PHONE · CONTACT_EMAIL · CONTACT_PHONE · BUSINESS_ADDRESS ·
SOCIAL_INSTAGRAM · SOCIAL_FACEBOOK · SOCIAL_LINKEDIN · MARKET_COUNTRY ·
MARKET_LOCALE · DEFAULT_CURRENCY · MAP_CENTER_LAT · MAP_CENTER_LNG · MAP_ZOOM ·
DEMO_MODE

Cambiar la marca = **una variable** (sin tocar código). SEO dinámico usa
`BRAND_NAME` en title/OG de property.html.

## Gate 11 — prueba ejecutada (VERIFIED)
1. `BRAND_NAME = "DEMO BRAND GATE"` + `BRAND_DESCRIPTION = "Prueba temporal…"` → deploy.
2. `<title>… | DEMO BRAND GATE</title>` y `og:site_name` reflejaron la marca temporal.
3. Restaurado a NEXO (sin vars activas).

### Advertencia (riesgo P2)
Tras el deploy, Smart Placement sirvió **transitoriamente** la versión anterior
en algunos colos (respuestas mixtas /api/config vs property title durante unos
minutos). Documentado en `DEPLOYMENT.md`: esperar ~60s en smoketests.

## Hardcoding restante (documentado, no refactorizado)
- Literales "NEXO" en markup visible (logo texto, hero, footer, alt). Cambiar
  esos textos = rebrand completo; se documenta en `TAKEOVER.md` §2.
- Nombre del worker (`name` en wrangler.toml) define subdominio *.workers.dev.
