# NEXO Inmueble

> **NEXO — Conecta con tu próximo lugar.**

NEXO es una plataforma inmobiliaria **mobile-first para Cuba**, diseñada para descubrir, buscar, publicar y administrar propiedades desde una experiencia moderna, minimalista y premium.

El proyecto está construido sobre Cloudflare Workers + D1 y utiliza una arquitectura sencilla, rápida y escalable.

---

# 🎯 Visión

NEXO busca ofrecer una experiencia inmobiliaria diferente en Cuba:

- Interfaz limpia y premium.
- Experiencia optimizada para dispositivos móviles.
- Inventario conectado directamente a la base de datos.
- Búsqueda inmobiliaria inteligente.
- Mapa interactivo.
- Geolocalización de propiedades.
- Favoritos.
- Detalles de propiedades.
- NEXO IA.
- Panel privado de administración.
- Protección de información privada de propietarios.
- Arquitectura preparada para crecer.

NEXO comienza enfocado en Cuba, con especial atención inicial a **La Habana**.

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
| Geocodificación | Nominatim / OpenStreetMap |
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

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/health` | Estado del servicio |
| POST | `/api/admin/login` | Sesión de administración (cookie HttpOnly) |
| POST | `/api/admin/logout` | Cierre de sesión |
| GET | `/api/admin/session` | Verificación de sesión |
| GET | `/api/properties` | Catálogo (público: solo `available`) |
| GET | `/api/properties?ids=A,B` | Comparación (máx. 5 IDs) |
| GET | `/api/properties/:id` | Detalle público de propiedad |
| POST | `/api/search` | Búsqueda inteligente |
| POST | `/api/ia` | NEXO IA (búsqueda / recomendación / comparación) |
| POST | `/api/properties` | Crear propiedad (admin) |
| PUT/PATCH | `/api/properties/:id` | Editar propiedad (admin) |
| DELETE | `/api/properties/:id` | Eliminar propiedad (admin) |
| POST | `/api/properties/:id/geocode` | Geocodificación manual (admin) |

Las rutas públicas nunca exponen `owner_name`, `owner_phone`,
`contact_email`, `notes` ni `address` exacta sin sesión admin.

---

# ✅ Estado del proyecto (MVP)

| Fase | Resultado | Estado |
|---|---|---|
| 1 | Auditoría y estabilización de base | ✔ Completada |
| 2 | Consolidación del área administrativa | ✔ Completada |
| 3 | Integración geográfica y mapa | ✔ Completada |
| 4 | Integración profunda de NEXO IA | ✔ Completada |
| 5 | Comparación inteligente y bases futuras | ✔ Completada |
| 6 | Revisión final y MVP | ✔ Completada |

**Flujo de negocio verificado:**
Admin (crear/editar → geocodificación automática o manual) →
D1 → Mapa público → Catálogo → Comparación → NEXO IA
(búsqueda / recomendación / comparación sobre inventario real).

**Preparado para futuras fases:** tablas `users` y `favorites`
ya existen en el esquema (vacías); índices de provincia y precio
listos para escala geográfica.

---

# 🚀 Despliegue

```bash
# Esquema de base de datos (idempotente)
wrangler d1 execute nexo-db --remote --file=schema.sql

# Secreto de administración
wrangler secret put ADMIN_TOKEN

# Publicar
wrangler deploy
```