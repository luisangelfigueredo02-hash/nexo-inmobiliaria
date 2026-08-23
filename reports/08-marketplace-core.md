# FASE 08 — Marketplace core

**Objetivo:** núcleo funcional completo para el usuario final, y admin para gestión.

## PUBLIC (VERIFIED)
- Búsqueda textual + filtros (operación, tipo, provincia, precio, dormitorios,
  moneda, sort) en Home.
- Resultados con cards → Property detail con galería, precio/moneda, atributos,
  descripción, CTA WhatsApp, fav, share.
- Mapa (Leaflet self-hosted + fallback CDN) y comparar.
- IA con inventario real (no hallucinación; honesto ante 0 resultados).
- Favoritos persistentes por cuenta (FASE 07) o fallback localStorage anónimo.
- Estados: loading, empty, error, offline parciales (`showState`, SW tolerante).
- Sin PII pública (owner_name/phone/internal_notes nunca en `/api/properties`).

## ADMIN (VERIFIED)
- Bearer ADMIN_TOKEN → crear/editar/eliminar, publicar/despublicar (status),
  upload de imágenes R2 (dropzone + progreso + reorder), geolocalización por
  clic en mapa, validación, CSV import/export, DEMO_MODE.

## Gate 08 — Flujo usuario (VERIFIED en prod)
1. Registra → 201.
2. Busca/filtra → cards.
3. Abre propiedad → galería.
4. Marca favorito → PUT /api/me/favorites 200.
5. Contacta → WhatsApp (wa.me deep link).
6. Vuelve → sesión persiste; favorites sobreviven re-login.

## Observaciones
- Recovery de cuenta imposible sin email provider (P1 abierta).
- Empty state catalog comunica "no hay inmuebles" en lugar de quedar mudo.
