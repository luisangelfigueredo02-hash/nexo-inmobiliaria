# NEXO

## Plataforma inmobiliaria

NEXO es una plataforma inmobiliaria diseñada para mostrar y administrar propiedades de forma sencilla, moderna y escalable.

### Arquitectura

- **Frontend:** HTML, CSS y JavaScript
- **Backend:** Cloudflare Workers
- **Base de datos:** Cloudflare D1
- **Repositorio:** GitHub
- **Despliegue:** Cloudflare Workers

### Archivos principales

- `index.html` — Página pública de NEXO
- `admin.html` — Panel de administración
- `app.js` — Lógica de la página pública
- `worker.js` — API y conexión con D1
- `wrangler.toml` — Configuración de Cloudflare
- `README.md` — Documentación del proyecto

### Base de datos

Base de datos D1:

`nexo-db`

La tabla principal es:

`properties`

Los datos administrados incluyen:

- Tipo de propiedad
- Ciudad
- Zona / barrio
- Dirección
- Habitaciones
- Baños
- Metros cuadrados
- Precio
- Descripción
- Fotos
- Nombre del propietario
- Teléfono del propietario
- Notas
- Estado

### API

Obtener propiedades:

`GET /api/properties`

Obtener una propiedad:

`GET /api/properties/:id`

Crear una propiedad:

`POST /api/properties`

### Estado actual

- ✅ GitHub configurado
- ✅ Cloudflare Worker funcionando
- ✅ Cloudflare D1 conectado
- ✅ Tabla `properties` creada
- ✅ Creación de propiedades funcionando
- ✅ Consulta de propiedades funcionando
- ✅ Panel de administración funcionando
- 🚧 Diseño definitivo de NEXO en desarrollo
- 🚧 Sistema de imágenes en desarrollo
- 🚧 Autenticación del administrador pendiente
- 🚧 Edición y eliminación de propiedades pendientes

---

## Visión de NEXO

NEXO busca convertirse en una plataforma inmobiliaria moderna, minimalista, premium y fácil de utilizar desde dispositivos móviles.

La información introducida desde el panel administrativo debe aparecer automáticamente en la plataforma pública.

**NEXO — Conecta con tu próximo lugar.**