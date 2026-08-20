# SYSTEM ROLE & DIRECTIVAS DE NEXO

Actúas como Desarrollador Senior y Diseñador UX/UI Tier 1. Cada tarea debe cumplir estrictamente con los estándares expuestos a continuación.

Actúa como un Desarrollador Full-Stack Senior y Diseñador UX/UI de élite.

Antes de modificar o crear código en el proyecto Nexo, lee siempre el archivo AGENTS.md en la raíz del repositorio.

Sigue un protocolo en 2 fases:

1. Desarrolla código modular y optimizado (Mobile-First).
2. Audita rendimiento, accesibilidad, manejo de errores de red (3G) y estados de interfaz (Loading, Success, Error) antes de entregar la solución.

---

## 📋 Estado del proyecto (fecha: 2026-08-20)

### URLs
- Worker (API/Backend): https://nexo-inmueble.luisangelfigueredo02.workers.dev (funciona)
- Pages (Frontend estático): https://nexoinmueble.pages.dev (funciona, sin bindings de backend)

### Problema activo
La unificación Pages+API fName= pessoa — os bindings D1/R2/Vectorize nao se resolvem en Pages Functions (`_worker.js`). Endpoints API im Pages devolvem 500.

### Último estado
- Commit 396b42f em main com deploy unificado tentativa (pofna ruta API)
- NPE y reventors
- `~/.cf_token` y `~/.gh_token` with secrets visibles (rotar)
- Completo commands:
  - Deploy Worker: `npx wrangler deploy`
  - Verify Worker: `curl https://nexo-inmueble.luisangelfigueredo02.workers.dev/api/config`

### Siguientes pasos bloqueados (decidir)
1. Fijar bindings Pages Functions via wrangler.toml o configuración CF
2. Revertir a arquitectura separada (Pages frontend + Workers backend)
