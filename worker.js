// worker.js - NEXO Master API, SEO & AI Engine

import { enforceRateLimit, rejectResponse, NO_CACHE_HEADERS, LIMIT_DEF } from "./rate-limit.js";
import { getAuthenticatedSession, destroySession, isStateChangingAllowed } from "./session-runtime.js";

// Cliente Sentry mínimo (sin dependencias) para capturar errores no controlados
function reportError(env, ctx, error, requestUrl) {
  if (!env.SENTRY_DSN) return;
  const dsn = env.SENTRY_DSN;
  const match = dsn.match(/^(https?):\/\/([^@]+)@([^/]+)\/(\d+)$/);
  if (!match) return;
  const [, protocol, key, host, projectId] = match;
  const payload = {
    message: error.message || String(error),
    level: "error",
    platform: "javascript",
    server_name: "nexo-inmueble",
    tags: { url: requestUrl },
    extra: { stack: error.stack },
    timestamp: (Date.now() / 1000),
  };
  ctx.waitUntil(
    fetch(`${protocol}://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    }).catch(() => {})
  );
}

// Escape de datos provenientes de D1 antes de inyectar en HTML (SEO interceptor)
function escHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape para valores dentro de JSON-LD (evita romper el script con comillas)
function escJson(str) {
  return String(str == null ? "" : str)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

// Validación server-side de propiedad (admin POST/PUT). La del frontend no es suficiente.
// Devuelve string con el error o null si válido.
function validatePropertyInput(data) {
  if (!data || typeof data !== "object") return "Payload inválido";
  if (!data.title || typeof data.title !== "string" || data.title.trim().length < 3 || data.title.length > 200) {
    return "title requerido (3-200 caracteres)";
  }
  const ALLOWED_TYPES = ["casa", "apartamento", "terreno", "penthouse", "Casa", "Apartamento", "Terreno", "Penthouse"];
  if (data.type && !ALLOWED_TYPES.includes(data.type)) return "type inválido";
  const ALLOWED_OPS = ["venta", "alquiler"];
  if (data.operation && !ALLOWED_OPS.includes(data.operation)) return "operation inválida";
  const price = parseFloat(data.price);
  if (isNaN(price) || price < 0 || price > 999_000_000) return "price inválido";
  const beds = parseInt(data.bedrooms ?? 0, 10);
  if (isNaN(beds) || beds < 0 || beds > 50) return "bedrooms inválido";
  const baths = parseInt(data.bathrooms ?? 0, 10);
  if (isNaN(baths) || baths < 0 || baths > 50) return "bathrooms inválido";
  const area = parseFloat(data.area ?? 0);
  if (isNaN(area) || area < 0 || area > 100_000) return "area inválida";
  // Coordenadas: null/undefined/"" se tratan como ausentes (no como error).
  if (data.latitude != null && data.latitude !== "" && (isNaN(parseFloat(data.latitude)) || Math.abs(parseFloat(data.latitude)) > 90)) {
    return "latitude inválida";
  }
  if (data.longitude != null && data.longitude !== "" && (isNaN(parseFloat(data.longitude)) || Math.abs(parseFloat(data.longitude)) > 180)) {
    return "longitude inválida";
  }
  if (data.description && String(data.description).length > 5000) return "description excede 5000 caracteres";
  if (data.images && (!Array.isArray(data.images) || data.images.length > 40)) return "images inválidas (máx 40)";
  if (Array.isArray(data.images)) {
    for (const url of data.images) {
      if (typeof url !== "string" || url.length > 500) return "image URL inválida";
      // Solo permitimos rutas /media/* o http(s) externas explícitas del panel
          if (/^(javascript|data|file):/i.test(url)) return "image URL con esquema prohibido";
      // Solo se permiten rutas /media/* (R2) o https:// externas explícitas
      if (!url.startsWith("/media/") && !/^https:\/\//i.test(url)) return "image URL debe ser /media/* o https://";
    }
  }

  const ALLOWED_STATUS = ["published", "draft"];
  if (data.status && !ALLOWED_STATUS.includes(data.status)) return "status inválido";
  return null;
}

// Normaliza coordenadas para persistencia: NULL si ausente (nunca 0),
// número si presente. Llamar después de validatePropertyInput (ya validó rango).
function normalizeCoord(value) {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

/* =========================================================
   SECURITY HEADERS BASELINE (04.2.1)
   - CSP hash-based: ningún script inline se ejecuta salvo los
     sha256 listados abajo (generados desde los HTML de public/).
     script-src NO lleva 'unsafe-inline'.
   - style-src 'unsafe-inline' es una excepción documentada: las
     páginas usan atributos style= extensivamente y Leaflet inyecta
     estilos inline en el mapa. Los atributos style= no pueden
     cubrirse por hash (CSP solo hashea elementos <style>).
   - img-src https: porque las fichas admiten URLs de fotos externas
     arbitrarias (panel admin) además de /media/* (R2) y el fallback.
   - connect-src incluye *.ingest.sentry.io: el beacon Sentry del
     frontend es opt-in vía window.__SENTRY_DSN (vacío = inerte).
========================================================= */

// === GENERATED CSP-SCRIPT-SRC:BEGIN (scripts/generate-csp-hashes.mjs, no editar a mano) ===
const CSP_SCRIPT_SRC = "'self' https://unpkg.com 'sha256-NrzaWnsjOu1ZAhFEpP1o+wYS0eRr5mU6WCMsAZockGk=' 'sha256-X1+NFVlpfDhIGbwE78nVUvjWPb5x6TU/1Hl6HpjSMe8=' 'sha256-cj+xP4VvVU4mMT+NWCf992zhnujY/t9Sf6qU6IcdtuE=' 'sha256-kQlCj9qMO2xDUQUAJV/jS73uuXUY3voXEsEEiHg6PH8=' 'sha256-o08bddWbJ/IzIgR00hBRqFu+/6sMrOkz9zymrJU8w9U=' 'sha256-obiTLnS/y6BeEzKCtQ3jTRfZ2HObfPZoZ+s++fRrLH8=' 'sha256-ow5J81bvIAcViT02n5kJQl35m+TaUiLeIEvxncpvPZk=' 'sha256-vxJ7leDBrqXJjUVrVQqgthikAZNpK4DVv0XvrnZAcC4=' 'sha256-yJu3FsIaHh1tSlyaCNuksaOURnf2j3dZJ60v+AfuWY0='";
// === GENERATED CSP-SCRIPT-SRC:END ===

const CSP_POLICY = [
  "default-src 'self'",
  `script-src ${CSP_SCRIPT_SRC}`,
  "style-src 'self' 'unsafe-inline' https://unpkg.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https://*.ingest.sentry.io",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP_POLICY,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY", // redundante con frame-ancestors para UA legacy
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

// Aplica la baseline a toda respuesta del origen (API, SEO, assets, media).
// CORP: /media/* es contenido público embebible (OG/SEO); el resto same-origin.
function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  const path = new URL(request.url).pathname;
  headers.set("Cross-Origin-Resource-Policy", path.startsWith("/media/") ? "cross-origin" : "same-origin");
  // no-store por defecto en API; respeta políticas más estrictas ya
  // establecidas por el handler (p.ej. NO_CACHE_HEADERS de sesiones).
  if (path.startsWith("/api/") && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    try {
      return withSecurityHeaders(await this.route(request, env, ctx), request);
    } catch (error) {
      reportError(env, ctx, error, request.url);
      return withSecurityHeaders(new Response("Internal Error", { status: 500 }), request);
    }
  },

  async route(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // Configuración global de WhatsApp
    const WHATSAPP_PHONE = env.WHATSAPP_PHONE || "+5350000000";

    // CORS: EXPLICIT ALLOWLIST. La app es same-origin (frontend en el mismo
    // Worker), así que los orígenes autorizables son el propio del deployment
    // en producción y localhost exclusivamente en desarrollo local (wrangler dev).
    // *.workers.dev arbitrarios NO se permiten.
    const PRODUCTION_ORIGINS = new Set([
      url.origin, // el deployment actual (p.ej. https://nexo-inmueble.<cuenta>.workers.dev)
    ]);
    const isLocalDev = ["localhost", "127.0.0.1"].includes(url.hostname);
    const DEVELOPMENT_ORIGINS = new Set(isLocalDev ? [
      "http://localhost",
      "http://localhost:8787",
      "http://127.0.0.1",
      "http://127.0.0.1:8787",
    ] : []);

    const requestOrigin = request.headers.get("Origin");
    const allowedOrigin = (() => {
      if (!requestOrigin) return null;
      let o;
      try { o = new URL(requestOrigin); } catch (e) { return null; }
      const full = o.origin; // scheme + host + puerto normalizado
      if (PRODUCTION_ORIGINS.has(full)) return full;
      if (isLocalDev && DEVELOPMENT_ORIGINS.has(full)) return full;
      return null;
    })();

    const isAdminRoute = url.pathname.startsWith("/api/admin/");
    // Credenciales (cookies) solo en la superficie de sesión (04.3): el resto
    // de la API pública sigue sin cookies, minimizando exposición CSRF/CORS.
    const isSessionRoute = url.pathname.startsWith("/api/session/");

    const corsHeaders = allowedOrigin && !isAdminRoute
      ? {
          "Access-Control-Allow-Origin": allowedOrigin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Vary": "Origin",
          // Nunca "*" con credenciales; solo el origen explícito de la allowlist.
          ...(isSessionRoute ? { "Access-Control-Allow-Credentials": "true" } : {}),
        }
      : {};

    if (method === "OPTIONS") {
      // Preflight solo para orígenes permitidos; admin sin CORS
      if (isAdminRoute || !allowedOrigin) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { headers: corsHeaders });
    }

    // Comparación de secretos en tiempo constante, robusta ante longitudes
    // diferentes: itera siempre `max` caracteres (la longitud mayor se extiende
    // con ceros); el acumulador solo es 0 si ambas cadenas son idénticas en
    // contenido Y longitud. El tiempo de ejecución depende solo de max(a,b),
    // nunca del contenido → no hay fuga de posición ni de longitud relativa.
    const timingSafeEqual = (a, b) => {
      const sa = String(a || "");
      const sb = String(b || "");
      const max = Math.max(sa.length, sb.length);
      if (max === 0) return false;
      let diff = sa.length ^ sb.length; // 0 solo si misma longitud
      for (let i = 0; i < max; i++) {
        const ca = i < sa.length ? sa.charCodeAt(i) : 0;
        const cb = i < sb.length ? sb.charCodeAt(i) : 0;
        diff |= ca ^ cb;
      }
      return diff === 0;
    };

    // Autenticación administrativa: un único secreto canónico (ADMIN_TOKEN).
    // ADMIN_PASSWORD queda como fallback legacy temporal (deprecar en futura fase).
    const isAdmin = (req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
      const token = authHeader.slice("Bearer ".length).trim();
      if (!token) return false;
      if (env.ADMIN_TOKEN && timingSafeEqual(token, env.ADMIN_TOKEN)) return true;
      if (env.ADMIN_PASSWORD && timingSafeEqual(token, env.ADMIN_PASSWORD)) return true;
      return false;
    };

    // Normalizador de imágenes para prevenir inconsistencias de formato
    const normalizeImages = (imagesStr) => {
      if (!imagesStr) return [];
      try {
        const parsed = JSON.parse(imagesStr);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === "string") return [parsed];
        return [];
      } catch (e) {
        if (imagesStr.startsWith("http") || imagesStr.startsWith("/")) return [imagesStr];
        return [];
      }
    };

    // --- SESSION RUNTIME (04.3) ---
    // Superficie mínima: status + logout. NO auth endpoints (login/signup/
    // passkey/magic-link/recovery/oauth) — Authentication es una fase futura.
    if (url.pathname === "/api/session/status" && method === "GET") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);

      const session = await getAuthenticatedSession(request, env, ctx);
      // Mínimo: booleano + identificador público (account id opaco, no email).
      // Jamás token, hash, stamps ni campos internos. Respuesta uniforme
      // ante sesión inexistente/revocada/expirada (anti-enumeración).
      return new Response(JSON.stringify(
        session.authenticated
          ? { authenticated: true, accountId: session.accountId }
          : { authenticated: false }
      ), {
        status: 200,
        headers: { "Content-Type": "application/json", ...NO_CACHE_HEADERS, ...corsHeaders }
      });
    }

    if (url.pathname === "/api/session/logout" && method === "POST") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);

      // CSRF: mutante con cookie → Origin debe estar en la allowlist
      // (o ausente: same-origin + SameSite=Lax). "null" rechazado.
      if (!isStateChangingAllowed(request, allowedOrigin)) {
        return new Response(JSON.stringify({ error: "Origin no permitido" }), {
          status: 403,
          headers: { "Content-Type": "application/json", ...NO_CACHE_HEADERS, ...corsHeaders }
        });
      }

      const { cookie } = await destroySession(request, env);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": cookie,
          ...NO_CACHE_HEADERS,
          ...corsHeaders
        }
      });
    }

    // --- HEALTH CHECK ---
    if (url.pathname === "/api/health" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // --- SEO INTERCEPTOR PARA DETALLES DE PROPIEDAD ---
    if (url.pathname === "/property.html" && method === "GET") {
      const id = url.searchParams.get("id");
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/property";
      assetUrl.search = "";
      assetUrl.hash = "";
      const assetRes = await env.ASSETS.fetch(new Request(assetUrl)).catch(() => null);
      let htmlContent = assetRes && assetRes.ok ? await assetRes.text() : PROPERTY_HTML_TEMPLATE;

      if (id) {
        try {
          const property = await env.DB.prepare(
            "SELECT id, title, description, images, price, city, province FROM properties WHERE id = ?"
          ).bind(id).first();
          if (property) {
            const images = normalizeImages(property.images);
            const mainImage = images[0] || "https://nexo.estate/placeholder.jpg";
            
            const seoTitle = escHtml(property.title);
            const seoDesc = escHtml(property.description ? property.description.substring(0, 155) : "");
            const seoImage = escHtml(mainImage);
            const seoTags = `
              <title>${seoTitle} | NEXO</title>
              <meta name="description" content="${seoDesc || 'Propiedad en Cuba'}.">
              <meta property="og:title" content="${seoTitle} - NEXO">
              <meta property="og:description" content="${seoDesc}">
              <meta property="og:image" content="${seoImage}">
              <meta property="og:type" content="website">
              <meta name="twitter:card" content="summary_large_image">
              <meta name="twitter:title" content="${seoTitle}">
              <meta name="twitter:description" content="${seoDesc}">
              <meta name="twitter:image" content="${seoImage}">
              <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "RealEstateListing",
                "name": "${escJson(property.title)}",
                "description": "${escJson(property.description)}",
                "price": "${escJson(property.price)}",
                "priceCurrency": "USD",
                "address": {
                  "@type": "PostalAddress",
                  "addressLocality": "${escJson(property.city)}",
                  "addressRegion": "${escJson(property.province)}"
                }
              }
              </script>
            `;
            htmlContent = htmlContent.replace("<!-- SEO_TAGS -->", seoTags);
          }
        } catch (err) {
          console.error("Error en SEO dinámico:", err);
        }
      }
      return new Response(htmlContent, { headers: { "Content-Type": "text/html" } });
    }

    // --- SERVIR FOTOS DESDE R2 (MEDIA) con negociación de formato ---
    if (url.pathname.startsWith("/media/") && env.BUCKET_IMAGENES && (method === "GET" || method === "HEAD")) {
      let key = decodeURIComponent(url.pathname.slice("/media/".length));
      const accept = request.headers.get("accept") || "";

      // Negociación WebP: si la key apunta a un JPG original y el cliente acepta
      // WebP, probamos cada variante por ancho (-w400/-w800/-w1200) hasta servir
      // la que exista. El frontend pide una variante concreta vía srcset.
      const isOriginalJpg = /\.(jpe?g|png)$/i.test(key) && !/-w(400|800|1200)\.webp$/i.test(key);
      let format = isOriginalJpg && accept.includes("image/webp") ? "webp" : null;
      let object = null;
      if (format) {
        const widths = [400, 800, 1200];
        const requestedWidth = (url.searchParams.get("w") || "").match(/^\d+$/) ? parseInt(url.searchParams.get("w"), 10) : null;
        const order = requestedWidth ? [requestedWidth, ...widths.filter(w => w !== requestedWidth)] : widths;
        for (const w of order) {
          const webpKey = key.replace(/\.(jpe?g|png)$/i, `-w${w}.webp`);
          object = method === "HEAD"
            ? await env.BUCKET_IMAGENES.head(webpKey)
            : await env.BUCKET_IMAGENES.get(webpKey);
          if (object) break;
        }
        if (!object) format = null; // fallback al original si no hay variante optimizada
      }
      if (!object) {
        object = method === "HEAD" ? await env.BUCKET_IMAGENES.head(key) : await env.BUCKET_IMAGENES.get(key);
      }
      if (!object) return new Response("Not Found", { status: 404, headers: corsHeaders });

      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      if (format) headers.set("Vary", "Accept");
      return new Response(method === "HEAD" ? null : object.body, { headers });
    }

    // --- CONFIGURACIÓN PÚBLICA ---
    if (url.pathname === "/api/config" && method === "GET") {
      return new Response(JSON.stringify({ whatsapp_phone: WHATSAPP_PHONE }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // --- CATÁLOGO PÚBLICO DE PROPIEDADES ---
    if (url.pathname === "/api/properties" && method === "GET") {
      try {
        const type = url.searchParams.get("type");
        const operation = url.searchParams.get("operation");
        const maxPrice = url.searchParams.get("maxPrice");
        const province = url.searchParams.get("province");
        const bedrooms = url.searchParams.get("bedrooms");

        let query = "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at FROM properties WHERE status = 'published'";
        const params = [];

        // Comparación case-insensitive: la BD mezcla valores capitalizados
        // (p.ej. 'Apartamento') y el frontend envía minúsculas ('apartamento')
        if (type) { query += " AND LOWER(type) = LOWER(?)"; params.push(type); }
        if (operation) { query += " AND LOWER(operation) = LOWER(?)"; params.push(operation); }
        if (maxPrice) { query += " AND price <= ?"; params.push(parseFloat(maxPrice)); }
        if (province) { query += " AND province = ?"; params.push(province); }
        if (bedrooms) { query += " AND bedrooms >= ?"; params.push(parseInt(bedrooms)); }

        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();

        const formatted = results.map(row => ({
          ...row,
          images: normalizeImages(row.images)
        }));

        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // --- PROPIEDADES SIMILARES PÚBLICAS (±30% PRECIO) ---
    const similarMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)\/similar$/);
    if (similarMatch && method === "GET") {
      const id = similarMatch[1];
      try {
        const row = await env.DB.prepare("SELECT price, city, province FROM properties WHERE id = ? AND status = 'published'").bind(id).first();
        if (!row) {
          return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }

        const minPrice = row.price * 0.7;
        const maxPrice = row.price * 1.3;

        let { results } = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND city = ? AND price BETWEEN ? AND ? LIMIT 4"
        ).bind(id, row.city, minPrice, maxPrice).all();

        if (results.length === 0) {
          const provRes = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' AND id != ? AND province = ? AND price BETWEEN ? AND ? LIMIT 4"
          ).bind(id, row.province, minPrice, maxPrice).all();
          results = provRes.results;
        }

        const formatted = results.map(r => ({ ...r, images: normalizeImages(r.images) }));
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // --- DETALLE PÚBLICO DE PROPIEDAD ---
    const detailMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)$/);
    if (detailMatch && method === "GET") {
      const id = detailMatch[1];
      try {
        const row = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude FROM properties WHERE id = ? AND status = 'published'"
        ).bind(id).first();

        if (!row) {
          return new Response(JSON.stringify({ error: "Propiedad no encontrada o inactiva" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const formatted = { ...row, images: normalizeImages(row.images) };
        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // =========================================================================
    // RUTAS ADMINISTRATIVAS PROTEGIDAS (RESTAURADAS AL 100%)
    // =========================================================================

    // 1. Verificar Login
    if (url.pathname === "/api/admin/verify" && method === "POST") {
      if (isAdmin(request)) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      return new Response(JSON.stringify({ error: "Credenciales inválidas" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 2. Listado Completo Admin (Incluye datos privados)
    if (url.pathname === "/api/admin/properties" && method === "GET") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      try {
        // ADMIN DTO: campos explícitos (incluye privados, es el panel admin).
        // Campos internos futuros no se filtrarán accidentalmente al panel.
        const { results } = await env.DB.prepare(
          "SELECT id, title, type, operation, price, province, city, neighborhood, address, bedrooms, bathrooms, area, description, images, latitude, longitude, status, owner_name, owner_phone, internal_notes, created_at FROM properties ORDER BY created_at DESC"
        ).all();
        const formatted = results.map(row => ({
          ...row,
          images: normalizeImages(row.images)
        }));
        return new Response(JSON.stringify(formatted), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 3. Crear Propiedad (Admin) + Vectorize Sync
    if (url.pathname === "/api/admin/properties" && method === "POST") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      try {
        const data = await request.json();

        // --- Validación server-side de inputs (la del frontend no es suficiente) ---
        const validationError = validatePropertyInput(data);
        if (validationError) {
          return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        // ID secuencial N-001...: el INSERT con subconsulta de MAX es atómico
        // en SQLite → elimina la race condition de "leer último + insertar".
        // Si dos requests concurrentes calculan el mismo id, el UNIQUE/PK del
        // segundo falla y reintentamos con el siguiente número (máx 3 intentos).
        const imagesStr = JSON.stringify(data.images || []);
        let generatedId = null;

        for (let attempt = 0; attempt < 3 && !generatedId; attempt++) {
          try {
            const inserted = await env.DB.prepare(`
              INSERT INTO properties (id, title, type, operation, price, province, city, neighborhood, address, bedrooms, bathrooms, area, description, images, latitude, longitude, status, owner_name, owner_phone, internal_notes)
              SELECT
                'N-' || printf('%03d',
                  COALESCE(
                    (SELECT MAX(CAST(SUBSTR(id, 3) AS INTEGER)) FROM properties WHERE id LIKE 'N-%'),
                    0
                  ) + 1 + ?),
                ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
              RETURNING id
            `).bind(
              attempt,
              data.title, data.type, data.operation, parseFloat(data.price),
              data.province, data.city, data.neighborhood, data.address || "",
              parseInt(data.bedrooms || 0), parseInt(data.bathrooms || 0), parseFloat(data.area || 0),
              data.description || "", imagesStr, normalizeCoord(data.latitude), normalizeCoord(data.longitude),
              data.status || "published", data.owner_name || "", data.owner_phone || "", data.internal_notes || ""
            ).first();
            generatedId = inserted && inserted.id;
          } catch (insertErr) {
            // Conflicto de PK: otro request ganó la carrera → reintentar
            if (attempt === 2) throw insertErr;
          }
        }

        // Sincronizar con Vectorize si el binding existe
        if (env.AI && env.VECTORIZE && (data.status || "published") === "published") {
          try {
            const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
            const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
            const vector = embeddingResponse.data[0];

            await env.VECTORIZE.upsert([{
              id: generatedId,
              values: vector,
              metadata: { title: data.title, price: data.price, location: data.neighborhood }
            }]);
          } catch (vErr) {
            console.error("Vectorize sync failed on creation:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true, id: generatedId }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 4. Editar Propiedad (Admin) + Vectorize Sync
    if (url.pathname.startsWith("/api/admin/properties/") && method === "PUT") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      const id = url.pathname.split("/").pop();
      try {
        const data = await request.json();

        // Misma validación server-side que POST: PUT no puede introducir lo que POST rechaza
        const validationError = validatePropertyInput(data);
        if (validationError) {
          return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        // Propiedad inexistente → 404 (nunca success:true)
        const existing = await env.DB.prepare("SELECT id FROM properties WHERE id = ?").bind(id).first();
        if (!existing) {
          return new Response(JSON.stringify({ error: "Propiedad no encontrada" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }

        const imagesStr = JSON.stringify(data.images || []);

        await env.DB.prepare(`
          UPDATE properties SET 
            title = ?, type = ?, operation = ?, price = ?, province = ?, city = ?, neighborhood = ?, address = ?, 
            bedrooms = ?, bathrooms = ?, area = ?, description = ?, images = ?, latitude = ?, longitude = ?, 
            status = ?, owner_name = ?, owner_phone = ?, internal_notes = ?
          WHERE id = ?
        `).bind(
          data.title, data.type, data.operation, parseFloat(data.price), data.province, data.city, data.neighborhood,
          data.address || "", parseInt(data.bedrooms || 0), parseInt(data.bathrooms || 0), parseFloat(data.area || 0),
          data.description || "", imagesStr, normalizeCoord(data.latitude), normalizeCoord(data.longitude),
          data.status, data.owner_name || "", data.owner_phone || "", data.internal_notes || "", id
        ).run();

        // Actualizar o remover del índice vectorial según el estado
        if (env.AI && env.VECTORIZE) {
          try {
            if (data.status === "published") {
              const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
              const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
              const vector = embeddingResponse.data[0];

              await env.VECTORIZE.upsert([{
                id: id,
                values: vector,
                metadata: { title: data.title, price: data.price, location: data.neighborhood }
              }]);
            } else {
              await env.VECTORIZE.deleteByIds([id]);
            }
          } catch (vErr) {
            console.error("Vectorize sync failed on update:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // 5. Eliminar Propiedad (Admin)
    if (url.pathname.startsWith("/api/admin/properties/") && method === "DELETE") {
      if (!isAdmin(request)) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      const id = url.pathname.split("/").pop();
      try {
        await env.DB.prepare("DELETE FROM properties WHERE id = ?").bind(id).run();

        if (env.VECTORIZE) {
          try {
            await env.VECTORIZE.deleteByIds([id]);
          } catch (vErr) {
            console.error("No se pudo eliminar de Vectorize:", vErr);
          }
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }

    // =========================================================================
    // NEXO IA CHATBOT CON VECTORIZE & LLM
    // =========================================================================
    if (url.pathname === "/api/chat" && method === "POST") {
      try {
        const { message } = await request.json();
        if (!message) {
          return new Response(JSON.stringify({ error: "Mensaje requerido" }), { status: 400, headers: corsHeaders });
        }

        // Rate limit ANTES de cualquier costo AI (requerido 03.3)
        const rate = await enforceRateLimit(env, request);
        if (rate.limited) {
          return rejectResponse(rate.retryAfter, corsHeaders);
        }

        let matchedProperties = [];

        // Búsqueda semántica híbrida con Vectorize
        if (env.AI && env.VECTORIZE) {
          try {
            const queryEmbeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [message] });
            const queryVector = queryEmbeddingResponse.data[0];

            const vecResults = await env.VECTORIZE.query(queryVector, { topK: 4 });
            if (vecResults.matches && vecResults.matches.length > 0) {
              const matchedIds = vecResults.matches.map(match => match.id);
              const placeholders = matchedIds.map(() => "?").join(",");
              
              const { results } = await env.DB.prepare(
                `SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE id IN (${placeholders}) AND status = 'published'`
              ).bind(...matchedIds).all();
              
              matchedProperties = results.map(row => ({
                ...row,
                images: normalizeImages(row.images)
              }));
            }
          } catch (aiErr) {
            console.error("Falla en contexto vectorial, usando fallback de texto:", aiErr);
          }
        }

        // Fallback de texto si Vectorize no devolvió resultados
        if (matchedProperties.length === 0) {
          const { results } = await env.DB.prepare(
            "SELECT id, title, type, operation, price, province, city, neighborhood, bedrooms, bathrooms, area, description, images FROM properties WHERE status = 'published' LIMIT 3"
          ).all();
          matchedProperties = results.map(row => ({
            ...row,
            images: normalizeImages(row.images)
          }));
        }

        // Contexto estructurado para el LLM
        const contextString = matchedProperties.map(p => 
          `ID: ${p.id}\nTítulo: ${p.title}\nTipo: ${p.type}\nOperación: ${p.operation}\nPrecio: ${p.price} USD\nUbicación: ${p.neighborhood}, ${p.city}, ${p.province}\nHabitaciones: ${p.bedrooms}, Baños: ${p.bathrooms}, Área: ${p.area} m²\nDescripción: ${p.description}\n---`
        ).join("\n");

        const systemPrompt = `Eres NEXO IA, el asesor virtual premium y sofisticado de NEXO en Cuba. Tu tono es profesional, minimalista y educado.
        Recomienda exclusivamente propiedades del siguiente contexto real. Jamás inventes propiedades, ubicaciones o precios.
        Siempre que menciones o recomiendes un inmueble, cita explícitamente su ID entre corchetes, por ejemplo [${matchedProperties[0]?.id || 'N-001'}].
        
        Propiedades disponibles reales:
        ${contextString}`;

        const aiResponse = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        });

        return new Response(JSON.stringify({
          response: aiResponse.response,
          properties: matchedProperties
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders, ...NO_CACHE_HEADERS }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: "Error interno" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders, ...NO_CACHE_HEADERS }
        });
      }
    }

    // Servir estáticos de Cloudflare Assets
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};

const PROPERTY_HTML_TEMPLATE = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><!-- SEO_TAGS --></head><body></body></html>`;