# BUYER FAQ — NEXO

Respuestas verificadas contra producción y el repositorio (2026-08-23).

## ¿Qué incluye exactamente la compra?

El repositorio completo: código fuente (MIT), esquema D1 + 7 migraciones +
aplicador idempotente, herramienta de datos demo (seed/clear), sistema de
branding por variables, workflow de CI/CD, y documentación completa
(quickstart, takeover, deployment, seguridad, spec de producto + 38 reportes
de auditoría). Opcional: export del inventario demo actual y sus imágenes.

## ¿Está incluido el dominio?

No. Producción vive en `*.workers.dev` del vendedor. Puedes operar en tu
propio `*.workers.dev` gratis o conectar tu dominio (Cloudflare Custom
Domains, ~10–20 min). Ningún dominio está hardcodeado en el código.

## ¿Está incluida la cuenta de Cloudflare?

No. Creas los recursos en tu propia cuenta (worker, D1, R2, Vectorize) con
la guía incluida. El plan gratuito de Cloudflare basta para empezar.

## ¿Está incluido el repositorio de GitHub?

Sí — vía GitHub Transfer (el repo pasa a tu cuenta) o fork/zip entregado.
El historial incluye los 21+ gates de auditoría.

## ¿Puedo cambiar la marca?

Sí, sin tocar código: `BRAND_NAME`, colores, logo, tagline, descripción se
definen en variables de entorno (`wrangler.toml [vars]`) y se inyectan en
header, footer, SEO, manifest PWA y mensajes de WhatsApp. Test automatizado
de rebrand incluido.

## ¿Puedo cambiar el dominio?

Sí. Sitemap, robots y manifest se generan dinámicamente con el origin real
del despliegue. Cambiar de dominio no requiere ningún cambio de código.

## ¿Puedo usarlo para otro país?

Sí, con matiz: país, locale, moneda y centro del mapa son configuración.
La lista de provincias del filtro y la guía legal de compra vienen para
Cuba y requieren una edición puntual y documentada (TAKEOVER.md §2 indica
archivo y línea). La UI está en español.

## ¿Puedo usarlo para otro vertical (no inmobiliario)?

La estructura (catálogo + mapa + fichas + admin + IA) es reutilizable, pero
los campos del modelo son inmobiliarios (habitaciones, baños, m²…). Cambiar
de vertical es desarrollo nuevo, no configuración.

## ¿La IA está incluida?

Sí. Usa Cloudflare Workers AI (binding incluido, sin claves externas ni
coste de API de terceros) y responde con el inventario real. Está
rate-limited y es honesta cuando no hay resultados.

## ¿El panel admin está incluido?

Sí: CRUD de propiedades, subida de imágenes con drag & drop a R2, reordenado
de galería, geolocalización por clic, importación/exportación CSV. Acceso
por token Bearer que defines tú.

## ¿Se incluye el código fuente completo?

Sí, íntegro y sin partes privadas. Licencia MIT: puedes modificarlo,
revenderlo y sublicenciarlo.

## ¿Puedo desplegarlo yo mismo?

Sí. El quickstart (BUYER-QUICKSTART.md) está verificado: 12 pasos, 45–90
minutos para un desarrollador competente. No necesitas hablar con el
vendedor.

## ¿Genera revenue?

No. Es un activo de software pre-revenue. No hay ingresos, ni historial de
transacciones, ni monetización integrada (no procesa pagos).

## ¿Hay usuarios registrados?

No hay usuarios activos. La base se entrega saneada (0 cuentas activas, 0
sesiones — verificado 2026-08-23).

## ¿El inventario es real?

El inventario visible son 25 propiedades DEMO claramente rotuladas (banner,
badges y marca de agua) más 1 propiedad real usada en desarrollo. El demo
es reproducible y eliminable con un comando. No se presenta como inventario
comercial.

## ¿Qué tiene que pagar el comprador para operar?

- Cloudflare: $0 (free tier) para empezar; ~$5/mes (Workers Paid)
  recomendado para producción.
- Dominio propio (opcional): precio de registro habitual.
- Todo lo demás (D1, R2, Vectorize, Workers AI) tiene capa gratuita
  suficiente para arrancar.

## ¿Qué se necesita para operarlo?

Una cuenta de Cloudflare, las variables de marca configuradas y tu token
admin. No hay servidores, ni build, ni dependencias externas de pago.

## ¿Qué NO está incluido?

Dominio, cuenta Cloudflare del vendedor, cuentas/servicios de terceros,
monitoreo (Sentry opcional, vacío por defecto), proveedor de email (la
recuperación de contraseña lo requeriría), y cualquier desarrollo futuro.

## ¿Cuáles son las limitaciones conocidas?

1. Pre-revenue, sin usuarios ni tráfico.
2. Single-tenant: una marca por despliegue.
3. Sin pagos, sin chat interno, sin social login, sin analytics.
4. Sin recuperación de contraseña (requiere proveedor de email).
5. Datos de mercado (provincias, guía legal) configurados para Cuba.
6. Fichas con meta server-side pero body renderizado en cliente (SEO de
   listings vía sitemap + JS).
7. Sin clustering de markers en el mapa (relevante >100 listings).
8. UI en español (no hay i18n).

## ¿Cuánto tarda el takeover?

45–90 minutos para un despliegue completo con marca propia y dominio
(ESTIMATED, proceso verificado paso a paso). Cargar inventario por CSV:
30–60 min adicionales según volumen.

## ¿Cómo pruebo el producto antes de comprar?

La demo pública está en vivo: catálogo, mapa, comparador, IA, registro de
cuenta y favoritos pueden probarse sin credenciales. El panel admin puede
demostrarse en una llamada o con un token temporal acordado con el
vendedor. Ver la ruta de demo en §16 del reporte Gate 22
(reports/FINAL-GATE-22-SELLING-PACKAGE.md).
