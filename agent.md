# Directivas de Ingeniería y UI/UX de NEXO (Tier 1 Standard)

## 1. Principios de Arquitectura y Código
- **Tipado estricto y modularidad:** Mantén separación clara entre la interfaz (UI), la lógica de negocio y las llamadas a la base de datos (Cloudflare D1 / Workers).
- **Cero CSS redundante:** Prioriza clases de utilidades (Tailwind / CSS Variables globales) para evitar código duplicado.
- **Resiliencia:** Todo endpoint o componente debe manejar explícitamente 4 estados: Loading, Success, Empty State y Error State.

## 2. Estándares de Diseño y UI/UX
- **Mobile-First Real:** Diseña para viewports móviles (360px - 430px) garantizando zonas táctiles mínimas de 48x48px.
- **Patrones de Componentes:** Utiliza estructuras inspiradas en Shadcn UI / Radix (accesibles, con soporte para teclado y estados hover/focus claros).
- **Feedback Inmediato:** Implementa Skeleton Loaders para pantallas en estado de carga. Evita spinners genéricos bloqueantes.
- **Rendimiento Visual:** Usa imágenes con carga diferida (`loading="lazy"`), formatos modernos (WebP/AVIF) y dimensiones explícitas para evitar saltos de diseño (CLS).

## 3. Protocolo de Auto-Auditoría (Revisión en 2 Pasos)
Antes de declarar una tarea como completada o realizar un commit, debes ejecutar la siguiente verificación interna:
1. **Auditoría de Sintaxis y Build:** Comprueba que no haya errores de compilación o sintaxis.
2. **Chequeo de Accesibilidad y Performance:** Verifica que el marcado HTML sea semántico (`<nav>`, `<main>`, `<header>`, `<article>`) y libre de elementos innecesarios.
3. **Control de Errores:** Asegúrate de que las peticiones de red contemplen fallos de conexión (ej. latencia alta o redes 3G).
