import { enforceRateLimit, enforceScopedRateLimit, rejectResponse, NO_CACHE_HEADERS } from "./rate-limit.js";
import { getAuthenticatedSession, destroySession, createSession, isStateChangingAllowed } from "./session-runtime.js";
import { hashPassword, verifyPassword, isPasswordValid } from "./src/auth/passwords.js";
import { PERMISSIONS, legacyAdminActor, authorize, isAllowed, denyResponse, serializeProperty, emitAuthorizationAudit } from "./src/auth/authorization/index.js";
import { buildBrand, applyTokens, buildManifest, escHtml as escBrandHtml } from "./src/brand.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function clientContext(request) {
  const ua = (request.headers.get("User-Agent") || "").slice(0, 200) || null;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const ipSubset = ip ? ip.split(".").slice(0, 3).join(".") + ".0" : null;
  return { userAgent: ua, ipSubset };
}

// N-XXX = inventario real; D-XXX = inventario demo (14C). Ambos son public_code.
var PUBLIC_CODE_RE = /^(?:N|D)-\d+$/i;
function listingLookup(param) {
  return PUBLIC_CODE_RE.test(param) ? { column: "public_code", value: param.toUpperCase() } : { column: "id", value: param };
}
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
    timestamp: Date.now() / 1e3
  };
  ctx.waitUntil(
    fetch(`${protocol}://${host}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(payload)
    }).catch(() => {
    })
  );
}
function escHtml(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function escJson(str) {
  return String(str == null ? "" : str).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}
function extractAiText(aiResponse) {
  if (!aiResponse || typeof aiResponse !== "object") return "";
  if (typeof aiResponse.response === "string") return aiResponse.response;
  const content = aiResponse.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (typeof aiResponse.result === "string") return aiResponse.result;
  if (typeof aiResponse.text === "string") return aiResponse.text;
  return "";
}
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
  if (isNaN(price) || price < 0 || price > 999e6) return "price inválido";
  const beds = parseInt(data.bedrooms ?? 0, 10);
  if (isNaN(beds) || beds < 0 || beds > 50) return "bedrooms inválido";
  const baths = parseInt(data.bathrooms ?? 0, 10);
  if (isNaN(baths) || baths < 0 || baths > 50) return "bathrooms inválido";
  const area = parseFloat(data.area ?? 0);
  if (isNaN(area) || area < 0 || area > 1e5) return "area inválida";
  if (data.latitude != null && data.latitude !== "" && (isNaN(parseFloat(data.latitude)) || Math.abs(parseFloat(data.latitude)) > 90)) {
    return "latitude inválida";
  }
  if (data.longitude != null && data.longitude !== "" && (isNaN(parseFloat(data.longitude)) || Math.abs(parseFloat(data.longitude)) > 180)) {
    return "longitude inválida";
  }
  if (data.description && String(data.description).length > 5e3) return "description excede 5000 caracteres";
  if (data.images && (!Array.isArray(data.images) || data.images.length > 40)) return "images inválidas (máx 40)";
  if (Array.isArray(data.images)) {
    for (const url of data.images) {
      if (typeof url !== "string" || url.length > 500) return "image URL inválida";
      if (/^(javascript|data|file):/i.test(url)) return "image URL con esquema prohibido";
      if (!url.startsWith("/media/") && !/^https:\/\//i.test(url)) return "image URL debe ser /media/* o https://";
    }
  }
  const ALLOWED_STATUS = ["published", "draft"];
  if (data.status && !ALLOWED_STATUS.includes(data.status)) return "status inválido";
  const ALLOWED_CURRENCIES = ["USD", "EUR", "CUP"];
  if (data.currency != null && data.currency !== "" && !ALLOWED_CURRENCIES.includes(data.currency)) {
    return "currency inválida (USD, EUR, CUP)";
  }
  return null;
}
function normalizeCurrency(value) {
  if (value == null || value === "") return null;
  return String(value);
}
function normalizeCoord(value) {
  if (value == null || value === "") return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}
// RISK-05: rechaza claves que tras decodificación contengan segmentos de traversal, backslashes, o absolutos (R2 05.12-E)
function pathSegmentsUnsafe(key) {
  return key.split("/").some((seg) => seg === ".." || seg === "" || seg === ".");
}
// === GENERATED CSP-SCRIPT-SRC:BEGIN (scripts/generate-csp-hashes.mjs, no editar a mano) ===
const CSP_SCRIPT_SRC = "'self' https://unpkg.com 'sha256-+MR2RqQmwkgF2nCzCLGIAkRZ6JLha92X4pCX12p1nNE=' 'sha256-AXL1iY0pBw/iR4h1Tn/X76v9wSnHD2xgv8PcMwJ272s=' 'sha256-G6B1Yk6Q6cgQZtV1PWy3eSrBQRAUxWXj/kwNEd6Cjuc=' 'sha256-L5hpy6a+nJAMYGKs3Nu3QRRQckKdaynwt0lbZOO+fYg=' 'sha256-cZJZxPWh7Oczrm4/qwWl6Z10BGjf+urpF1w72YuQn04=' 'sha256-cj+xP4VvVU4mMT+NWCf992zhnujY/t9Sf6qU6IcdtuE=' 'sha256-ebNrBEyBPbWX3IpEKOsYL8DpsFpMnytqzmwFy9PsGNw=' 'sha256-fj9+zBQfQIlDCa+BuU3/qrUKsE6OMOLXcJ85wQakD0M=' 'sha256-k8/QEzy6VTXR1kQye4ofYhJXP6juQ9dnP+qQIuWw5ms=' 'sha256-knJdgz0IpHdH8NNEwMnhYGWf/ra01qX12bT34lMUt7U=' 'sha256-o08bddWbJ/IzIgR00hBRqFu+/6sMrOkz9zymrJU8w9U=' 'sha256-obiTLnS/y6BeEzKCtQ3jTRfZ2HObfPZoZ+s++fRrLH8='";
// === GENERATED CSP-SCRIPT-SRC:END ===
var CSP_POLICY = [
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
  "upgrade-insecure-requests"
].join("; ");
// CSP por respuesta para HTML transformado (white-label): applyTokens cambia
// los bytes de los <script> inline (p. ej. {{BRAND_NAME}}), así que los hashes
// estáticos de CSP_SCRIPT_SRC no coincidirían y el navegador bloquearía toda
// la JS de la app. Se hashean los scripts inline del HTML FINAL servido.
const INLINE_SCRIPT_RE = /<script>([\s\S]*?)<\/script>/g;
async function cspForHtml(html) {
  const hashes = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1]));
    hashes.push(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`);
  }
  return CSP_POLICY.replace(CSP_SCRIPT_SRC, `'self' https://unpkg.com ${hashes.join(" ")}`);
}
var SECURITY_HEADERS = {
  "Content-Security-Policy": CSP_POLICY,
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  // redundante con frame-ancestors para UA legacy
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin"
};
function withSecurityHeaders(response, request) {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    // El CSP por respuesta (HTML transformado white-label) tiene prioridad.
    if (k === "Content-Security-Policy" && headers.has(k)) continue;
    headers.set(k, v);
  }
  const path = new URL(request.url).pathname;
  headers.set("Cross-Origin-Resource-Policy", path.startsWith("/media/") ? "cross-origin" : "same-origin");
  if (path.startsWith("/api/") && !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "no-store");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
export default {
  async fetch(request, env, ctx) {
    try {
      return withSecurityHeaders(await this.route(request, env, ctx), request);
    } catch (error) {
      console.error("worker fetch error:", error.message || error, error.stack || "");
      reportError(env, ctx, error, request.url);
      return withSecurityHeaders(new Response("Internal Error", { status: 500 }), request);
    }
  },
  async route(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    const BRAND = buildBrand(env);
    const WHATSAPP_PHONE = BRAND.whatsapp;
    const MARKET_CONFIG = {
      whatsapp_phone: WHATSAPP_PHONE,
      market_country: BRAND.country,
      market_country_code: BRAND.countryCode,
      market_locale: BRAND.locale,
      default_currency: BRAND.currency,
      map_center: [BRAND.mapCenterLat, BRAND.mapCenterLng],
      map_zoom: BRAND.mapZoom,
      demo_mode: BRAND.demoMode,
      brand: {
        name: BRAND.name,
        logo: BRAND.logo,
        description: BRAND.description,
        tagline: BRAND.tagline,
        theme_color: BRAND.secondaryColor,
        primary_color: BRAND.primaryColor,
        secondary_color: BRAND.secondaryColor,
        bg_color: BRAND.bgColor
      },
      business: {
        name: BRAND.businessName,
        legal_name: BRAND.legalName,
        email: BRAND.email || null,
        phone: BRAND.phone || null,
        address: BRAND.address || null
      },
      social: {
        instagram: BRAND.socialInstagram || null,
        facebook: BRAND.socialFacebook || null,
        linkedin: BRAND.socialLinkedin || null
      }
    };
    const PRODUCTION_ORIGINS = new Set([
      url.origin
      // el deployment actual (p.ej. https://nexo-inmueble.<cuenta>.workers.dev)
    ]);
    const isLocalDev = ["localhost", "127.0.0.1"].includes(url.hostname);
    const DEVELOPMENT_ORIGINS = new Set(isLocalDev ? [
      "http://localhost",
      "http://localhost:8787",
      "http://127.0.0.1",
      "http://127.0.0.1:8787"
    ] : []);
    const requestOrigin = request.headers.get("Origin");
    const allowedOrigin = (() => {
      if (!requestOrigin) return null;
      let o;
      try {
        o = new URL(requestOrigin);
      } catch (e) {
        return null;
      }
      const full = o.origin;
      if (PRODUCTION_ORIGINS.has(full)) return full;
      if (isLocalDev && DEVELOPMENT_ORIGINS.has(full)) return full;
      return null;
    })();
    const isAdminRoute = url.pathname.startsWith("/api/admin/");
    // Plano de sesión con credenciales: cookie __Host-session (04.3).
    const isSessionRoute = url.pathname.startsWith("/api/session/")
      || url.pathname.startsWith("/api/auth/")
      || url.pathname.startsWith("/api/me/");
    const corsHeaders = allowedOrigin && !isAdminRoute ? {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Vary": "Origin",
      // Nunca "*" con credenciales; solo el origen explícito de la allowlist.
      ...isSessionRoute ? { "Access-Control-Allow-Credentials": "true" } : {}
    } : {};
    if (method === "OPTIONS") {
      if (isAdminRoute || !allowedOrigin) {
        return new Response(null, { status: 204 });
      }
      return new Response(null, { headers: corsHeaders });
    }
    const timingSafeEqual = ((a, b) => {
      const sa = String(a || "");
      const sb = String(b || "");
      const max = Math.max(sa.length, sb.length);
      if (max === 0) return false;
      let diff = sa.length ^ sb.length;
      for (let i = 0; i < max; i++) {
        const ca = i < sa.length ? sa.charCodeAt(i) : 0;
        const cb = i < sb.length ? sb.charCodeAt(i) : 0;
        diff |= ca ^ cb;
      }
      return diff === 0;
    });
    const isAdmin = ((req) => {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) return false;
      const token = authHeader.slice("Bearer ".length).trim();
      if (!token) return false;
      if (env.ADMIN_TOKEN && timingSafeEqual(token, env.ADMIN_TOKEN)) return true;
      // 05.13 RISK-01: fallback legacy aislado. Solo activo si se define explícitamente,
      // y marcado para deprecation en takeover. No se elimina destructivamente para
      // evitar lockout administrativo si un operador depende de él.
      if (env.ADMIN_PASSWORD && timingSafeEqual(token, env.ADMIN_PASSWORD)) return true;
      return false;
    });
    const correlationId = crypto.randomUUID();
    const authorizeAdminPlane = (async (action) => {
      if (!isAdmin(request)) return null;
      const actor = legacyAdminActor();
      const decision = await authorize(actor, action, null, { env });
      if (!isAllowed(decision)) {
        await emitAuthorizationAudit(env, ctx, {
          actor,
          action,
          resourceType: "property",
          decision: decision.decision,
          reason: decision.reason,
          request,
          correlationId
        });
        return { actor, decision };
      }
      return { actor, decision };
    });
    const normalizeImages = ((imagesStr) => {
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
    });
    if (url.pathname === "/api/session/status" && method === "GET") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
      const session = await getAuthenticatedSession(request, env, ctx);
      return new Response(JSON.stringify(
        session.authenticated ? { authenticated: true, accountId: session.accountId } : { authenticated: false }
      ), {
        status: 200,
        headers: { "Content-Type": "application/json", ...NO_CACHE_HEADERS, ...corsHeaders }
      });
    }
    if (url.pathname === "/api/session/logout" && method === "POST") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
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
    // ===== Autenticación pública (registro / login) =====
    const authJson = async () => {
      try { return await request.json(); } catch { return null; }
    };
    const authJsonReq = (res, status, cookie, extraHeaders = {}) => new Response(JSON.stringify(res), {
      status,
      headers: { "Content-Type": "application/json", ...(cookie ? { "Set-Cookie": cookie } : {}), ...NO_CACHE_HEADERS, ...corsHeaders, ...extraHeaders }
    });
    if (url.pathname === "/api/auth/register" && method === "POST") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
      if (!isStateChangingAllowed(request, allowedOrigin)) return authJsonReq({ error: "Origin no permitido" }, 403);
      const body = await authJson();
      const email = String(body?.email || "").trim().toLowerCase();
      const name = String(body?.name || "").trim().slice(0, 80) || null;
      if (!EMAIL_RE.test(email)) return authJsonReq({ error: "Email inválido" }, 400);
      if (!isPasswordValid(body?.password)) return authJsonReq({ error: "La contraseña debe tener entre 8 y 128 caracteres" }, 400);
      const existing = await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first();
      if (existing) return authJsonReq({ error: "Ya existe una cuenta con ese email" }, 409);
      const accountId = crypto.randomUUID();
      const hash = await hashPassword(body.password);
      try {
        await env.DB.prepare(
          "INSERT INTO accounts (id, email, security_stamp, password_hash) VALUES (?, ?, ?, ?)"
        ).bind(accountId, email, crypto.randomUUID(), hash).run();
        await env.DB.prepare("INSERT INTO profiles (account_id, display_name) VALUES (?, ?)").bind(accountId, name).run();
      } catch (err) {
        return authJsonReq({ error: "No se pudo crear la cuenta" }, 500);
      }
      const session = await createSession(env, accountId, clientContext(request));
      return authJsonReq({ authenticated: true, accountId, name }, 201, session.cookie);
    }
    if (url.pathname === "/api/auth/login" && method === "POST") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
      // 14F: límite estricto anti fuerza-bruta (10 intentos / 5 min / IP).
      const authRate = await enforceScopedRateLimit(env, request, "auth-login");
      if (authRate.limited) return rejectResponse(authRate.retryAfter, corsHeaders);
      if (!isStateChangingAllowed(request, allowedOrigin)) return authJsonReq({ error: "Origin no permitido" }, 403);
      const body = await authJson();
      const email = String(body?.email || "").trim().toLowerCase();
      const row = await env.DB.prepare(
        "SELECT id, password_hash, status FROM accounts WHERE email = ?"
      ).bind(email).first();
      // Respuesta uniforme ante credenciales inválidas (anti-enumeración).
      if (!row || row.status !== "active" || !(row.password_hash && await verifyPassword(String(body?.password || ""), row.password_hash))) {
        return authJsonReq({ error: "Credenciales inválidas" }, 401);
      }
      const profile = await env.DB.prepare("SELECT display_name FROM profiles WHERE account_id = ?").bind(row.id).first().catch(() => null);
      const session = await createSession(env, row.id, clientContext(request));
      return authJsonReq({ authenticated: true, accountId: row.id, name: profile?.display_name || null }, 200, session.cookie);
    }
    // ===== Favoritos persistentes por cuenta =====
    if (url.pathname === "/api/me/favorites" && method === "GET") {
      const session = await getAuthenticatedSession(request, env, ctx);
      if (!session.authenticated) return authJsonReq({ favorites: null, error: "No autenticado" }, 401);
      const rows = await env.DB.prepare(
        `SELECT af.listing_id, p.public_code FROM account_favorites af JOIN properties p ON p.id = af.listing_id WHERE af.account_id = ?`
      ).bind(session.accountId).all().catch(() => ({ results: [] }));
      const favorites = (rows.results || []).map(r => r.public_code || String(r.listing_id));
      return authJsonReq({ favorites }, 200);
    }
    if (url.pathname === "/api/me/favorites" && method === "PUT") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
      if (!isStateChangingAllowed(request, allowedOrigin)) return authJsonReq({ error: "Origin no permitido" }, 403);
      const session = await getAuthenticatedSession(request, env, ctx);
      if (!session.authenticated) return authJsonReq({ error: "No autenticado" }, 401);
      const body = await authJson();
      const listingRef = String(body?.listing || "").trim();
      if (!listingRef) return authJsonReq({ error: "Falta listing" }, 400);
      const lookup = listingLookup(listingRef);
      const property = await env.DB.prepare(`SELECT id FROM properties WHERE ${lookup.column} = ?`).bind(lookup.value).first();
      if (!property) return authJsonReq({ error: "Inmueble no encontrado" }, 404);
      try {
        await env.DB.prepare(
          "INSERT OR IGNORE INTO account_favorites (account_id, listing_id) VALUES (?, ?)"
        ).bind(session.accountId, property.id).run();
      } catch {}
      return authJsonReq({ ok: true, favorites: true }, 200);
    }
    if (url.pathname.startsWith("/api/me/favorites/") && method === "DELETE") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
      if (!isStateChangingAllowed(request, allowedOrigin)) return authJsonReq({ error: "Origin no permitido" }, 403);
      const session = await getAuthenticatedSession(request, env, ctx);
      if (!session.authenticated) return authJsonReq({ error: "No autenticado" }, 401);
      const listingRef = decodeURIComponent(url.pathname.slice("/api/me/favorites/".length));
      const lookup = listingLookup(listingRef);
      const property = await env.DB.prepare(`SELECT id FROM properties WHERE ${lookup.column} = ?`).bind(lookup.value).first();
      if (property) {
        await env.DB.prepare(
          "DELETE FROM account_favorites WHERE account_id = ? AND listing_id = ?"
        ).bind(session.accountId, property.id).run();
      }
      return authJsonReq({ ok: true }, 200);
    }
    if (url.pathname === "/api/health" && method === "GET") {
      return new Response(JSON.stringify({ ok: true, timestamp: (new Date()).toISOString() }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (url.pathname === "/property.html" && method === "GET") {
      const id = url.searchParams.get("id");
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/property";
      assetUrl.search = "";
      assetUrl.hash = "";
      const assetRes = env.ASSETS ? await env.ASSETS.fetch(new Request(assetUrl)).catch(() => null) : null;
      let htmlContent = assetRes && assetRes.ok ? await assetRes.text() : PROPERTY_HTML_TEMPLATE;
      if (id) {
        try {
          const lookup = listingLookup(id);
          const property = await env.DB.prepare(
            `SELECT id, public_code, title, description, images, price, currency, city, province, latitude, longitude, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE ${lookup.column} = ?`
          ).bind(lookup.value).first();
          if (property) {
            const brandName = BRAND.name;
            const brandDesc = BRAND.description;
            const origin = url.origin;
            const images = normalizeImages(property.images);
            const rawImage = images[0] || "/icons/icon-512.png";
            const mainImage = rawImage.startsWith("/") ? origin + rawImage : rawImage;
            const canonicalUrl = `${origin}/property.html?id=${encodeURIComponent(property.public_code)}`;
            const seoTitle = escHtml(property.title);
            const seoDesc = escHtml(property.description ? property.description.substring(0, 155) : "");
            const seoImage = escHtml(mainImage);
            const seoUrl = escHtml(canonicalUrl);
            const seoBrand = escHtml(brandName);
            const seoBrandDesc = escHtml(brandDesc);
            const hasGeo = typeof property.latitude === "number" && typeof property.longitude === "number";
            const geoJson = hasGeo ? `,
                "geo": {
                  "@type": "GeoCoordinates",
                  "latitude": ${JSON.stringify(property.latitude)},
                  "longitude": ${JSON.stringify(property.longitude)}
                }` : "";
            const currencyJson = property.currency ? `,
                "priceCurrency": ${JSON.stringify(property.currency)}` : "";
            const seoTags = `
              <title>${seoTitle} | ${seoBrand}</title>
              <meta name="description" content="${seoDesc || seoBrandDesc}.">
              <link rel="canonical" href="${seoUrl}">
              <meta property="og:title" content="${seoTitle} - ${seoBrand}">
              <meta property="og:description" content="${seoDesc}">
              <meta property="og:image" content="${seoImage}">
              <meta property="og:url" content="${seoUrl}">
              <meta property="og:type" content="website">
              <meta property="og:locale" content="${escHtml(BRAND.locale)}">
              <meta property="og:site_name" content="${seoBrand}">
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
                "url": "${escJson(canonicalUrl)}",
                "image": "${escJson(mainImage)}",
                "price": "${escJson(property.price)}"${currencyJson},
                "address": {
                  "@type": "PostalAddress",
                  "addressLocality": "${escJson(property.city)}",
                  "addressRegion": "${escJson(property.province)}",
                  "addressCountry": "${escJson(BRAND.countryCode)}"
                }${geoJson}
              }
              <\/script>
            `;
            htmlContent = htmlContent.replace("<!-- SEO_TAGS -->", seoTags);
          }
        } catch (err) {
          console.error("Error en SEO dinámico:", err);
        }
      }
      const transformed = applyTokens(htmlContent, BRAND, url.origin);
      return new Response(transformed, {
        headers: { "Content-Type": "text/html", "Content-Security-Policy": await cspForHtml(transformed) }
      });
    }
    if ((url.pathname === "/manifest.json" || url.pathname === "/manifest.webmanifest") && method === "GET") {
      return new Response(JSON.stringify(buildManifest(BRAND, url.origin)), {
        headers: {
          "Content-Type": "application/manifest+json; charset=utf-8",
          "Cache-Control": "public, max-age=300"
        }
      });
    }
    if (url.pathname === "/sitemap.xml" && method === "GET") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT public_code FROM properties WHERE status = 'published' ORDER BY public_code"
        ).all();
        const origin = url.origin;
        const staticPages = ["/", "/mapa/", "/comparar/", "/ia/"];
        const urls = [
          ...staticPages.map((p) => `  <url><loc>${origin}${p}</loc></url>`),
          ...(results || []).map((r) => `  <url><loc>${origin}/property.html?id=${encodeURIComponent(r.public_code)}</loc></url>`)
        ].join("\n");
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600"
          }
        });
      } catch (err) {
        return new Response("Error generando sitemap", { status: 500 });
      }
    }
    // robots.txt dinámico: el sitemap apunta al origin real del deployment
    // (white-label: ningún dominio queda hardcodeado en el archivo estático).
    if (url.pathname === "/robots.txt" && method === "GET") {
      const body = [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /admin.html",
        "Disallow: /api/",
        "",
        `Sitemap: ${url.origin}/sitemap.xml`,
        ""
      ].join("\n");
      return new Response(body, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=3600"
        }
      });
    }
    if (url.pathname.startsWith("/media/") && env.BUCKET_IMAGENES && (method === "GET" || method === "HEAD")) {
      // 05.12/05.13 RISK-05: guard canónica — decodes fully and rejects traversal segments.
      // Operates on the raw prefix captured after "/media/". If the URL parser
      // already normalized the path (edge normalization), the guard still validates
      // the raw remainder plus every decoded iteration.
      let key = url.pathname.slice("/media/".length);
      try {
        let decoded = key;
        for (let i = 0; i < 3; i++) {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
          // Reject each decoded iteration, not just the final result, so multi-encoded
          // traversal never passes (double-encoded: decode1 → "%2e%2e" → decode2 → "..")
          if (decoded === "" || decoded.startsWith("/") || decoded.includes("\\") ||
              decoded.split("/").some((seg) => seg === ".." || seg === "" || seg === ".")) {
            return new Response("Not Found", { status: 404, headers: corsHeaders });
          }
        }
        key = decoded;
      } catch {
        return new Response("Bad Request", { status: 400, headers: corsHeaders });
      }
      if (key === "" || key.startsWith("/") || key.includes("\\") ||
          key.split("/").some((seg) => seg === ".." || seg === "" || seg === ".")) {
        return new Response("Not Found", { status: 404, headers: corsHeaders });
      }
      const accept = request.headers.get("accept") || "";
      const isOriginalJpg = /\.(jpe?g|png)$/i.test(key) && !/-w(400|800|1200)\.webp$/i.test(key);
      let format = isOriginalJpg && accept.includes("image/webp") ? "webp" : null;
      let object = null;
      if (format) {
        const widths = [400, 800, 1200];
        const requestedWidth = (url.searchParams.get("w") || "").match(/^\d+$/) ? parseInt(url.searchParams.get("w"), 10) : null;
        const order = requestedWidth ? [requestedWidth, ...widths.filter((w) => w !== requestedWidth)] : widths;
        for (const w of order) {
          const webpKey = key.replace(/\.(jpe?g|png)$/i, `-w${w}.webp`);
          object = method === "HEAD" ? await env.BUCKET_IMAGENES.head(webpKey) : await env.BUCKET_IMAGENES.get(webpKey);
          if (object) break;
        }
        if (!object) format = null;
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
    if (url.pathname === "/api/config" && method === "GET") {
      return new Response(JSON.stringify(MARKET_CONFIG), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (url.pathname === "/api/properties" && method === "GET") {
      try {
        const type = url.searchParams.get("type");
        const operation = url.searchParams.get("operation");
        const maxPrice = url.searchParams.get("maxPrice");
        const minPrice = url.searchParams.get("minPrice");
        const province = url.searchParams.get("province");
        const neighborhood = url.searchParams.get("neighborhood");
        const bedrooms = url.searchParams.get("bedrooms");
        const q = (url.searchParams.get("q") || "").trim().replace(/[%_]/g, "").slice(0, 120);
        let query = "SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, created_at, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE status = 'published'";
        const params = [];
        if (type) {
          query += " AND LOWER(type) = LOWER(?)";
          params.push(type);
        }
        if (operation) {
          query += " AND LOWER(operation) = LOWER(?)";
          params.push(operation);
        }
        if (maxPrice) {
          query += " AND price <= ?";
          params.push(parseFloat(maxPrice));
        }
        if (minPrice) {
          query += " AND price >= ?";
          params.push(parseFloat(minPrice));
        }
        if (province) {
          query += " AND province = ?";
          params.push(province);
        }
        if (neighborhood) {
          query += " AND LOWER(neighborhood) = LOWER(?)";
          params.push(neighborhood);
        }
        if (bedrooms) {
          query += " AND bedrooms >= ?";
          params.push(parseInt(bedrooms));
        }
        if (q) {
          const tokens = q.split(/\s+/).filter(Boolean).slice(0, 6);
          for (const tok of tokens) {
            query += " AND (LOWER(title) LIKE LOWER(?) OR LOWER(neighborhood) LIKE LOWER(?) OR LOWER(city) LIKE LOWER(?) OR LOWER(province) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?))";
            const like = `%${tok}%`;
            params.push(like, like, like, like, like);
          }
        }
        query += " ORDER BY created_at DESC";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        const formatted = results.map((row) => serializeProperty(row, "public"));
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
    const similarMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)\/similar$/);
    if (similarMatch && method === "GET") {
      const lookup = listingLookup(decodeURIComponent(similarMatch[1]));
      try {
        const row = await env.DB.prepare(
          `SELECT id, price, city, province FROM properties WHERE ${lookup.column} = ? AND status = 'published'`
        ).bind(lookup.value).first();
        if (!row) {
          return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json", ...corsHeaders } });
        }
        const minPrice = row.price * 0.7;
        const maxPrice = row.price * 1.3;
        let { results } = await env.DB.prepare(
          "SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE status = 'published' AND id != ? AND city = ? AND price BETWEEN ? AND ? LIMIT 4"
        ).bind(row.id, row.city, minPrice, maxPrice).all();
        if (results.length === 0) {
          const provRes = await env.DB.prepare(
            "SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE status = 'published' AND id != ? AND province = ? AND price BETWEEN ? AND ? LIMIT 4"
          ).bind(row.id, row.province, minPrice, maxPrice).all();
          results = provRes.results;
        }
        const formatted = results.map((r) => serializeProperty(r, "public"));
        return new Response(JSON.stringify(formatted), { headers: { "Content-Type": "application/json", ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }
    const detailMatch = url.pathname.match(/^\/api\/properties\/([^\/]+)$/);
    if (detailMatch && method === "GET") {
      const lookup = listingLookup(decodeURIComponent(detailMatch[1]));
      try {
        const row = await env.DB.prepare(
          `SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, latitude, longitude, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE ${lookup.column} = ? AND status = 'published'`
        ).bind(lookup.value).first();
        if (!row) {
          return new Response(JSON.stringify({ error: "Propiedad no encontrada o inactiva" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const formatted = serializeProperty(row, "public");
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
    if (url.pathname === "/api/admin/verify" && method === "POST") {
      const rate = await enforceRateLimit(env, request);
      if (rate.limited) return rejectResponse(rate.retryAfter, corsHeaders);
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
    if (url.pathname === "/api/admin/properties" && method === "GET") {
      const authz = await authorizeAdminPlane(PERMISSIONS.PROPERTY_READ_INTERNAL);
      if (!authz) {
        return new Response(JSON.stringify({ error: "No autorizado" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
      if (!isAllowed(authz.decision)) {
        return denyResponse(authz.decision, { corsHeaders, staff: true, resourceScoped: false });
      }
      try {
        const { results } = await env.DB.prepare(
          "SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, address, bedrooms, bathrooms, area, description, images, latitude, longitude, status, owner_name, owner_phone, internal_notes, created_at FROM properties ORDER BY created_at DESC"
        ).all();
        const formatted = results.map((row) => serializeProperty(row, "admin"));
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
    if (url.pathname === "/api/admin/properties" && method === "POST") {
      const authz = await authorizeAdminPlane(PERMISSIONS.PROPERTY_CREATE);
      if (!authz) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      if (!isAllowed(authz.decision)) {
        return denyResponse(authz.decision, { corsHeaders, staff: true, resourceScoped: false });
      }
      try {
        const data = await request.json();
        const validationError = validatePropertyInput(data);
        if (validationError) {
          return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const imagesStr = JSON.stringify(data.images || []);
        let generated = null;
        const columns = "title, type, operation, price, currency, province, city, neighborhood, address, bedrooms, bathrooms, area, description, images, latitude, longitude, status, owner_name, owner_phone, internal_notes";
        const values = [
          data.title,
          data.type,
          data.operation,
          parseFloat(data.price),
          normalizeCurrency(data.currency),
          data.province,
          data.city,
          data.neighborhood,
          data.address || "",
          parseInt(data.bedrooms || 0),
          parseInt(data.bathrooms || 0),
          parseFloat(data.area || 0),
          data.description || "",
          imagesStr,
          normalizeCoord(data.latitude),
          normalizeCoord(data.longitude),
          data.status || "published",
          data.owner_name || "",
          data.owner_phone || "",
          data.internal_notes || ""
        ];
        for (let attempt = 0; attempt < 3 && !generated; attempt++) {
          try {
            if (typeof env.DB.batch !== "function") {
              throw new Error("no such table: listing_id_sequence");
            }
            const seqStmts = [
              env.DB.prepare("UPDATE listing_id_sequence SET value = value + 1 WHERE name = 'public_code'"),
              env.DB.prepare(`
                INSERT INTO properties (public_code, ${columns})
                SELECT 'N-' || printf('%03d', (SELECT value FROM listing_id_sequence WHERE name = 'public_code')),
                  ${values.map(() => "?").join(", ")}
                RETURNING id, public_code
              `).bind(...values)
            ];
            const [, inserted] = await env.DB.batch(seqStmts);
            generated = inserted.results && inserted.results[0];
          } catch (seqErr) {
            if (!/no such table: listing_id_sequence/i.test(String(seqErr.message || seqErr))) {
              if (attempt === 2) throw seqErr;
              continue;
            }
            try {
              const inserted = await env.DB.prepare(`
                INSERT INTO properties (public_code, ${columns})
                SELECT 'N-' || printf('%03d',
                  COALESCE((SELECT MAX(CAST(SUBSTR(public_code, 3) AS INTEGER)) FROM properties WHERE public_code LIKE 'N-%'), 0) + 1 + ?),
                  ${values.map(() => "?").join(", ")}
                RETURNING id, public_code
              `).bind(attempt, ...values).first();
              generated = inserted;
            } catch (insertErr) {
              if (attempt === 2) throw insertErr;
            }
          }
        }
        const generatedId = generated && generated.id;
        const generatedCode = generated && generated.public_code;
        if (env.AI && env.VECTOR_INDEX && (data.status || "published") === "published") {
          try {
            const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
            const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
            const vector = embeddingResponse.data[0];
            await env.VECTOR_INDEX.upsert([{
              id: generatedCode,
              values: vector,
              metadata: { title: data.title, price: data.price, location: data.neighborhood }
            }]);
          } catch (vErr) {
            console.error("Vectorize sync failed on creation:", vErr);
          }
        }
        await emitAuthorizationAudit(env, ctx, {
          actor: authz.actor,
          action: PERMISSIONS.PROPERTY_CREATE,
          resourceType: "property",
          resourceId: generatedCode || generatedId,
          decision: authz.decision.decision,
          reason: authz.decision.reason,
          request,
          correlationId
        });
        return new Response(JSON.stringify({ success: true, id: generatedId, public_code: generatedCode }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }
    if (url.pathname.startsWith("/api/admin/properties/") && method === "PUT") {
      const authz = await authorizeAdminPlane(PERMISSIONS.PROPERTY_UPDATE);
      if (!authz) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      if (!isAllowed(authz.decision)) {
        return denyResponse(authz.decision, { corsHeaders, staff: true, resourceScoped: false });
      }
      const id = url.pathname.split("/").pop();
      try {
        const data = await request.json();
        const validationError = validatePropertyInput(data);
        if (validationError) {
          return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const existing = await env.DB.prepare("SELECT id, public_code FROM properties WHERE id = ?").bind(id).first();
        if (!existing) {
          return new Response(JSON.stringify({ error: "Propiedad no encontrada" }), {
            status: 404,
            headers: { "Content-Type": "application/json", ...corsHeaders }
          });
        }
        const imagesStr = JSON.stringify(data.images || []);
        await env.DB.prepare(`
          UPDATE properties SET
            title = ?, type = ?, operation = ?, price = ?, currency = ?, province = ?, city = ?, neighborhood = ?, address = ?,
            bedrooms = ?, bathrooms = ?, area = ?, description = ?, images = ?, latitude = ?, longitude = ?,
            status = ?, owner_name = ?, owner_phone = ?, internal_notes = ?
          WHERE id = ?
        `).bind(
          data.title,
          data.type,
          data.operation,
          parseFloat(data.price),
          normalizeCurrency(data.currency),
          data.province,
          data.city,
          data.neighborhood,
          data.address || "",
          parseInt(data.bedrooms || 0),
          parseInt(data.bathrooms || 0),
          parseFloat(data.area || 0),
          data.description || "",
          imagesStr,
          normalizeCoord(data.latitude),
          normalizeCoord(data.longitude),
          data.status,
          data.owner_name || "",
          data.owner_phone || "",
          data.internal_notes || "",
          id
        ).run();
        if (env.AI && env.VECTOR_INDEX) {
          try {
            if (data.status === "published") {
              const indexText = `${data.title}. Tipo: ${data.type} en ${data.neighborhood}, ${data.city}. ${data.bedrooms} habs, ${data.bathrooms} baños. ${data.description}`;
              const embeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [indexText] });
              const vector = embeddingResponse.data[0];
              await env.VECTOR_INDEX.upsert([{
                id: existing.public_code,
                values: vector,
                metadata: { title: data.title, price: data.price, location: data.neighborhood }
              }]);
            } else {
              await env.VECTOR_INDEX.deleteByIds([existing.public_code]);
            }
          } catch (vErr) {
            console.error("Vectorize sync failed on update:", vErr);
          }
        }
        await emitAuthorizationAudit(env, ctx, {
          actor: authz.actor,
          action: PERMISSIONS.PROPERTY_UPDATE,
          resourceType: "property",
          resourceId: existing.public_code || id,
          decision: authz.decision.decision,
          reason: authz.decision.reason,
          request,
          correlationId
        });
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
    if (url.pathname.startsWith("/api/admin/properties/") && method === "DELETE") {
      const authz = await authorizeAdminPlane(PERMISSIONS.PROPERTY_DELETE);
      if (!authz) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      if (!isAllowed(authz.decision)) {
        return denyResponse(authz.decision, { corsHeaders, staff: true, resourceScoped: false });
      }
      const id = url.pathname.split("/").pop();
      try {
        const victim = await env.DB.prepare("SELECT public_code FROM properties WHERE id = ?").bind(id).first();
        await env.DB.prepare("DELETE FROM properties WHERE id = ?").bind(id).run();
        if (env.VECTOR_INDEX && victim) {
          try {
            await env.VECTOR_INDEX.deleteByIds([victim.public_code]);
          } catch (vErr) {
            console.error("No se pudo eliminar de Vectorize:", vErr);
          }
        }
        await emitAuthorizationAudit(env, ctx, {
          actor: authz.actor,
          action: PERMISSIONS.PROPERTY_DELETE,
          resourceType: "property",
          resourceId: victim ? victim.public_code : id,
          decision: authz.decision.decision,
          reason: authz.decision.reason,
          request,
          correlationId
        });
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
    if (url.pathname === "/api/admin/upload-image" && method === "POST") {
      const authz = await authorizeAdminPlane(PERMISSIONS.PROPERTY_CREATE);
      if (!authz) {
        return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: corsHeaders });
      }
      if (!isAllowed(authz.decision)) {
        return denyResponse(authz.decision, { corsHeaders, staff: true, resourceScoped: false });
      }
      if (!env.BUCKET_IMAGENES) {
        return new Response(JSON.stringify({ error: "Storage no disponible" }), { status: 503, headers: corsHeaders });
      }
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") {
          return new Response(JSON.stringify({ error: "Archivo requerido" }), { status: 400, headers: corsHeaders });
        }
        const ct = String(file.type || "").toLowerCase();
        if (!/^image\/(jpeg|png|webp)$/.test(ct)) {
          return new Response(JSON.stringify({ error: "Solo JPEG, PNG o WebP" }), { status: 400, headers: corsHeaders });
        }
        const buf = await file.arrayBuffer();
        if (buf.byteLength > 5 * 1024 * 1024) {
          return new Response(JSON.stringify({ error: "Máximo 5MB" }), { status: 400, headers: corsHeaders });
        }
        const key = `uploads/${crypto.randomUUID()}.${{ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[ct]}`;
        await env.BUCKET_IMAGENES.put(key, buf, {
          httpMetadata: { contentType: ct }
        });
        await emitAuthorizationAudit(env, ctx, {
          actor: authz.actor,
          action: "image.upload",
          resourceType: "media",
          resourceId: key,
          decision: authz.decision.decision,
          reason: authz.decision.reason,
          request,
          correlationId
        });
        return new Response(JSON.stringify({ success: true, url: `/media/${key}` }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }
    }
    if (url.pathname === "/api/chat" && method === "POST") {
      try {
        const { message } = await request.json();
        if (!message || typeof message !== "string") {
          return new Response(JSON.stringify({ error: "Mensaje requerido" }), { status: 400, headers: corsHeaders });
        }
        // Coste por llamada (Workers AI): rechazar payloads abusivos antes de gastar.
        if (message.length > 2000) {
          return new Response(JSON.stringify({ error: "Mensaje demasiado largo (máx. 2000 caracteres)" }), { status: 400, headers: corsHeaders });
        }
        const rate = await enforceRateLimit(env, request);
        if (rate.limited) {
          return rejectResponse(rate.retryAfter, corsHeaders);
        }
        // A-08a: límite estricto — el chat consume Workers AI (coste por llamada).
        // __DISABLE_CHAT_SCOPE: escape hatch solo para tests del contador general.
        if (!env.__DISABLE_CHAT_SCOPE) {
          const chatRate = await enforceScopedRateLimit(env, request, "ai-chat");
          if (chatRate.limited) {
            return rejectResponse(chatRate.retryAfter, corsHeaders);
          }
        }
        let matchedProperties = [];
        if (env.AI && env.VECTOR_INDEX) {
          try {
            const queryEmbeddingResponse = await env.AI.run("@cf/baai/bge-small-en-v1.5", { text: [message] });
            const queryVector = queryEmbeddingResponse.data[0];
            const vecResults = await env.VECTOR_INDEX.query(queryVector, { topK: 4 });
            if (vecResults.matches && vecResults.matches.length > 0) {
              const matchedIds = vecResults.matches.map((match) => match.id);
              const placeholders = matchedIds.map(() => "?").join(",");
              const { results } = await env.DB.prepare(
                `SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE public_code IN (${placeholders}) AND status = 'published'`
              ).bind(...matchedIds).all();
              matchedProperties = results.map((row) => serializeProperty(row, "public"));
            }
          } catch (aiErr) {
            console.error("Falla en contexto vectorial, usando fallback de texto:", aiErr);
          }
        }
        if (matchedProperties.length === 0) {
          const { results } = await env.DB.prepare(
            "SELECT id, public_code, title, type, operation, price, currency, province, city, neighborhood, bedrooms, bathrooms, area, description, images, placa_libre, gas_calle, agua_247, pago_exterior FROM properties WHERE status = 'published' LIMIT 3"
          ).all();
          matchedProperties = results.map((row) => serializeProperty(row, "public"));
        }
        const contextString = matchedProperties.map(
          (p) => `ID: ${p.public_code}
Título: ${p.title}
Tipo: ${p.type}
Operación: ${p.operation}
Precio: ${p.price}${p.currency ? " " + p.currency : " (moneda no especificada)"}
Ubicación: ${p.neighborhood}, ${p.city}, ${p.province}
Habitaciones: ${p.bedrooms}, Baños: ${p.bathrooms}, Área: ${p.area} m²
Descripción: ${p.description}
---`
        ).join("\n");
        const systemPrompt = `Eres ${BRAND.name} IA, el asesor virtual premium y sofisticado de ${BRAND.name} en ${BRAND.country}. Tu tono es profesional, minimalista y educado.
        Recomienda exclusivamente propiedades del siguiente contexto real. Jamás inventes propiedades, ubicaciones o precios.
        Siempre que menciones o recomiendes un inmueble, cita explícitamente su ID entre corchetes, por ejemplo [${matchedProperties[0]?.public_code || "N-001"}].
        
        Propiedades disponibles reales:
        ${contextString}`;
        const aiResponse = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
          ]
        });
        return new Response(JSON.stringify({
          response: extractAiText(aiResponse) || null,
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
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      const contentType = assetRes.headers.get("Content-Type") || "";
      if (assetRes.ok && contentType.includes("text/html")) {
        const html = await assetRes.text();
        const transformed = applyTokens(html, BRAND, url.origin);
        const headers = new Headers(assetRes.headers);
        headers.set("Content-Type", "text/html; charset=utf-8");
        headers.set("Cache-Control", "public, max-age=0, must-revalidate");
        headers.set("Content-Security-Policy", await cspForHtml(transformed));
        return new Response(transformed, { status: assetRes.status, headers });
      }
      return assetRes;
    }
    return new Response("Not Found", { status: 404 });
  }
};
var PROPERTY_HTML_TEMPLATE = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><!-- SEO_TAGS --></head><body></body></html>`;
//# sourceMappingURL=worker.js.map