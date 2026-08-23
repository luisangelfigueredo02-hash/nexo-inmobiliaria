# NEXO Inmueble

> **NEXO — Conecta con tu próximo lugar.**

NEXO es una plataforma inmobiliaria **mobile-first para Cuba**, diseñada para descubrir, buscar, publicar y administrar propiedades desde una experiencia moderna, minimalista y premium.

El proyecto está construido sobre Cloudflare Workers + D1 y utiliza una arquitectura sencilla, rápida y escalable.

---

# 🎯 Visión

NEXO es una plataforma inmobiliaria **white-label**: la marca, el país, la
moneda, el WhatsApp comercial y los datos de contacto se configuran por
variables de entorno (ver `TAKEOVER.md` y `src/brand.js`), sin tocar código.

- Interfaz limpia y premium.
- Experiencia optimizada para dispositivos móviles.
- Inventario conectado directamente a la base de datos.
- Búsqueda inmobiliaria inteligente.
- Mapa interactivo.
- Geolocalización de propiedades.
- Favoritos.
- Detalles de propiedades.
- Asistente IA (`{{BRAND_NAME}} IA` en la UI, según marca configurada).
- Panel privado de administración.
- Protección de información privada de propietarios.
- Arquitectura preparada para crecer.

La configuración actual está enfocada en Cuba, con especial atención inicial a
**La Habana**. Ver `TAKEOVER.md` para despliegue, rebrand y entrega limpia.

---

# 🏗️ Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Aplicación pública | `public/index.html` |
| Administración | `public/admin.html` |
| Mapa | Leaflet + OpenStreetMap |
| Backend | Cloudflare Workers |
| Base de datos | Cloudflare D1 / SQLite |
| IA | Cloudflare Workers AI |
| Geolocalización | Coordenadas por clic en el mapa del admin (Leaflet) |
| Hosting | Cloudflare Workers |
| Código | GitHub |

---

# 📁 Estructura del proyecto

```text
/
├── public/
│   ├── index.html          # Catálogo público + mapa + IA launcher
│   ├── property.html       # Ficha pública de propiedad
│   ├── admin.html          # Panel privado de administración
│   ├── ia/
│   │   └── index.html      # NEXO IA (chat + resultados estructurados)
│   ├── mapa/
│   │   └── index.html      # Mapa público fullscreen
│   └── comparar/
│       └── index.html      # Comparación lado a lado
│
├── worker.js               # API completa (Workers)
├── schema.sql              # Esquema D1 (idempotente)
├── wrangler.toml
└── README.md
```

---

# 🔌 API

Rutas públicas:

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Estado del servicio |
| GET | `/api/config` | Config pública de marca/mercado (white-label) |
| GET | `/api/properties` | Catálogo publicado (filtros por query string) |
| GET | `/api/properties?ids=A,B` | Comparación (máx. 5) |
| GET | `/api/properties/:ref` | Detalle público (`public_code` N-XXX o id legacy) |
| GET | `/api/properties/:ref/similar` | Propiedades similares |
| POST | `/api/chat` | Asistente IA (rate limited) |
| GET | `/media/*` | Imágenes (R2, con negociación WebP) |
| GET | `/sitemap.xml` · `/robots.txt` · `/manifest.webmanifest` | Generados dinámicamente con el origin real |

Cuentas de usuario (cookie `__Host-session` HttpOnly):

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/auth/register` | Registro (email + password, PBKDF2-SHA256) |
| POST | `/api/auth/login` | Login |
| GET | `/api/session/status` | Estado de sesión |
| POST | `/api/session/logout` | Logout (CSRF por Origin) |
| GET/PUT/DELETE | `/api/me/favorites[/:ref]` | Favoritos de la cuenta |

Administración (header `Authorization: Bearer $ADMIN_TOKEN`):

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/admin/verify` | Verificar token |
| GET/POST | `/api/admin/properties` | Listar / crear propiedades |
| PUT/DELETE | `/api/admin/properties/:id` | Editar / eliminar |
| POST | `/api/admin/upload-image` | Subir imagen a R2 |

Las rutas públicas nunca exponen `owner_name`, `owner_phone`,
`contact_email`, `internal_notes` ni `address` exacta (serialización
whitelist por audiencia, ver `AUTHORIZATION.md`).

---

# ✅ Estado del proyecto

Plataforma funcional en producción. Flujo de negocio verificado:
Admin (crear/editar/publicar + imágenes R2) → D1 → Catálogo → Mapa →
Comparación → Asistente IA (sobre inventario real).

- Cuentas públicas de usuario (registro/login/favoritos) operativas.
- Modo demo reversible: `scripts/seed-demo.mjs` (ver `TAKEOVER.md` §5).
- White-label por variables de entorno: `src/brand.js` + `TAKEOVER.md` §2.
- Las tablas legacy vacías (`users`, `favorites`, `user_favorites`) son
  residuo inofensivo pendiente de cleanup; no las usa el código.

---

# 🚀 Despliegue

```bash
npm install

# 1. Base de datos (D1 recién creada: schema.sql PRIMERO)
npx wrangler d1 execute nexo-db --remote --file=schema.sql
node scripts/apply-migrations.mjs --remote

# 2. Secreto de administración
npx wrangler secret put ADMIN_TOKEN

# 3. Publicar
npx wrangler deploy
```

Usa SIEMPRE `scripts/apply-migrations.mjs` (no `wrangler d1 migrations
apply`): hace idempotente el ALTER de la migration 0007. Guía completa de
transferencia, rebrand y entrega limpia en `TAKEOVER.md`.

---

# 🧪 Tests

```bash
npm test       # suite completa (249 pruebas: rutas, auth, seguridad, white-label…)
npm run check  # validación de sintaxis del Worker
```