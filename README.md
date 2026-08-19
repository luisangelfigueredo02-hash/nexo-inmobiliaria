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
| Aplicación pública JS | `public/app.js` |
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
│   ├── index.html
│   ├── app.js
│   ├── property.html
│   ├── admin.html
│   ├── ia/
│   │   └── index.html
│   └── mapa/
│       └── index.html
│
├── worker.js
├── schema.sql
├── wrangler.toml
└── README.md