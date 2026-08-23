# FASE 06 — Product truth + UX/UI redesign (auditoría adversarial)

**Objetivo:** evaluar el producto como lo ve un usuario real y aplicar una crítica
adversarial al diseño actual. **Estado inicial:** diseño "insuficiente" según el
propietario (auditoría previa). **Método:** renderizado real en navegador
(desktop) + revisión de markup. Clasificación VERIFIED/INFERRED/ESTIMATED/UNKNOWN.

## Crítica adversarial (evidencia)
1. **Home:** hero (760px centrado) y grid (1180px) crean columnas desalineadas;
   chrome "Lista/Mapa" flotante desconectado de los resultados; chip "Más filtros"
   se mostraba como link azul (roto frente a chips neutras); trust-bar con error
   de concordancia "1 propiedades".
2. **Property detail:** sólido (galería, badges, stat cards, CTA WhatsApp). Verde
   WhatsApp cámarado intencionalmente.
3. **Mapa:** funcional tras las correcciones recientes (Leaflet self-hosted +
   fallback + empty state).
4. **Empty/error/loading:** existen (`showState` en index), con skeletoning
   limitado.
5. **Acceso a cuenta:** no existía (ahora `/cuenta/`).

## Cambios aplicados (esta fase)
- Trust-bar: concordancia singular/plural (`1 propiedad`).
- Chip "Más filtros": neutral, estado `aria-expanded` en acento.
- Nuevo punto de acceso "Entrar/Cuenta" en el header.

## Archivos afectados
- `public/index.html` (grammar + chip), capturas en observations/.

## UNKNOWN
- Lighthouse/web-vitals formales (ESTIMATED: TTFB ~100ms Edge; presupuesto
  público ~416KB de assets).

## Riesgos/siguiente gate
- Falta segunda pasada premium (FASE 09) para levantar la pauta visual.
- Gate 06: PROCESADO con correcciones parciales; el rediseño integral continúa
  en FASE 09 (polish).
