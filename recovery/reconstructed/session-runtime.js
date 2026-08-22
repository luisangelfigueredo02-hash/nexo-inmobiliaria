/* =========================================================
   NEXO — SESSION RUNTIME (04.3)
   Identity sessions server-side sobre el schema FROZEN:
   sessions(id, account_id, token_hash, device_label, user_agent,
            ip_subset, created_at, expires_at, revoked_at, last_seen_at)

   Principios:
   - Token opaco de 256 bits; en D1 solo su digest SHA-256 (hex).
     El plaintext token JAMÁS persiste, se devuelve ni se loguea.
   - Cookie __Host-session: HttpOnly; Secure; SameSite=Lax; Path=/;
     sin Domain. La sesión nunca vive en localStorage/sessionStorage/
     IndexedDB/Cache Storage.
   - Authentication (04.5+) materializa sesiones llamando createSession
     con el AuthSuccess del contrato 04.2 §11; no crea cookies ni TTL.
   - Authorization NO entra aquí: el contexto solo lleva
     { authenticated, accountId, sessionId }. Roles → 04.4.
========================================================= */

// Token: 256 bits (32 bytes) de crypto.getRandomValues → base64url (43 chars).
// Entropía completa del CSPRNG del runtime; no derivable de account_id,
// timestamps ni email.
const TOKEN_BYTES = 32;

// TTL (04.0 / contrato 04.2 §31): absolute 30 días fijo desde creación.
// Idle expiration (7d) NO implementada: el schema no tiene last_activity_at
// y last_seen_at es solo auditoría. Documentado en SESSION-RUNTIME.md.
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

// Rolling `last_seen_at`: throttle para no escribir en D1 en cada request.
// El test inyecta now() con saltos para ejercitar el comportamiento.
const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000;

// Límite de sesiones concurrentes activas por cuenta (04.0 / 04.2 §31).
// Fail-open: un error consultando el conteo no bloquea la creación.
const MAX_CONCURRENT_SESSIONS = 5;

export const SESSION_COOKIE_NAME = "__Host-session";
export const SESSION_COOKIE_ATTRS =
  "HttpOnly; Secure; SameSite=Lax; Path=/";

// SameSite=Lax (no Strict) — decisión documentada: Lax bloquea el envío
// cross-site en POST (anti-CSRF base) pero permite navegaciones top-level
// GET (magic link 04.6, compartir enlaces desde WhatsApp, SEO externo).
// Strict rompería la sesión al llegar desde esos enlaces.

function base64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function generateSessionToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

// SHA-256 del token → hex canónico. La comparación de hex de igual longitud
// con === es canónica; el atacante nunca controla el digest almacenado
// (derivado server-side), así que no hay comparación de secretos en juego.
export async function hashSessionToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return toHex(new Uint8Array(digest));
}

export function buildSessionCookie(token) {
  return `${SESSION_COOKIE_NAME}=${token}; ${SESSION_COOKIE_ATTRS}`;
}

// Limpieza: valor vacío + expiración pasada. Sin Max-Age=0 (el valor largo
// de Expires ya lo invalida y es compatible con todo cliente).
export function buildSessionClearCookie() {
  return `${SESSION_COOKIE_NAME}=; ${SESSION_COOKIE_ATTRS}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

// Parser estricto: nombre exacto, valor token base64url de 43 chars
// (32 bytes). Devuelve [] si no hay header.
export function parseSessionTokens(request) {
  const header = request.headers.get("Cookie");
  if (!header) return [];
  const out = [];
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === SESSION_COOKIE_NAME && /^[A-Za-z0-9_-]{43}$/.test(value)) out.push(value);
  }
  return out;
}

function ipSubset(request) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip) return null;
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  const segs = ip.split(":").filter(s => s !== "");
  return segs.slice(0, 4).join(":") + "::/64";
}

function userAgentBounded(request) {
  const ua = request.headers.get("User-Agent");
  return ua ? ua.slice(0, 200) : null;
}

// Crea sesión: genera token, hashea, inserta (expires absolute, last_seen),
// aplica límite de concurrencia revocando las más antiguas, y devuelve
// { token, sessionId, cookie }. `token` vive solo en memoria del llamador;
// nunca viaja a D1 ni a respuestas de API.
export async function createSession(env, accountId, requestContext = {}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const sessionId = crypto.randomUUID();
  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);

  const { userAgent = null, ipSubset = null, deviceLabel = null } = requestContext;

  await env.DB.prepare(
    `INSERT INTO sessions (id, account_id, token_hash, device_label, user_agent, ip_subset, created_at, expires_at, revoked_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
  ).bind(
    sessionId, accountId, tokenHash, deviceLabel, userAgent, ipSubset,
    now.toISOString(), expiresAt.toISOString(), now.toISOString()
  ).run();

  try {
    await env.DB.prepare(
      `UPDATE sessions SET revoked_at = ?
       WHERE id IN (
         SELECT id FROM sessions
         WHERE account_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC, rowid DESC
         LIMIT -1 OFFSET ?
       )`
    ).bind(now.toISOString(), accountId, MAX_CONCURRENT_SESSIONS).run();
  } catch (err) {
    console.error("session-runtime: límite de concurrencia fail-open:", err.message || err);
  }

  return { token, sessionId, cookie: buildSessionCookie(token) };
}

// Validación completa: cookie → token → hash → lookup (índice partial
// UNIQUE sobre token_hash) → revoked → expires (absolute) → cuenta activa
// → security_stamp vigente. Respuestas uniformes: cualquier fallo es
// simplemente "no autenticado" (anti-enumeración, §20/§22).
// ctx opcional: waitUntil para el rolling last_seen_at (fire-and-forget).
export async function getAuthenticatedSession(request, env, ctx = null, now = new Date()) {
  const unauthenticated = { authenticated: false, accountId: null, sessionId: null };

  for (const token of parseSessionTokens(request)) {
    const tokenHash = await hashSessionToken(token);
    const row = await env.DB.prepare(
      `SELECT s.id, s.account_id, s.expires_at, s.last_seen_at,
              a.status AS account_status, a.security_stamp AS account_security_stamp
       FROM sessions s JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL
       LIMIT 1`
    ).bind(tokenHash).first();

    if (!row) continue; // token desconocido o revocado → probar siguiente cookie
    if (new Date(row.expires_at).getTime() <= now.getTime()) continue;
    if (row.account_status !== "active") continue;

    const securityStamp = request.headers.get("X-Security-Stamp") || "";
    if (securityStamp && securityStamp !== row.account_security_stamp) continue;

    // Rolling last_seen (audit only), throttled, fuera del critical path.
    const lastSeen = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    if (now.getTime() - lastSeen > LAST_SEEN_THROTTLE_MS) {
      const update = env.DB.prepare(
        "UPDATE sessions SET last_seen_at = ? WHERE id = ?"
      ).bind(now.toISOString(), row.id).run();
      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(update.catch(err => console.error("session-runtime last_seen:", err.message || err)));
      } else {
        await update.catch(err => console.error("session-runtime last_seen:", err.message || err));
      }
    }

    return { authenticated: true, accountId: row.account_id, sessionId: row.id };
  }

  return unauthenticated;
}

// Revocación individual: revoke-at (no DELETE) para preservar audit trail.
export async function revokeSession(env, sessionId, now = new Date()) {
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL"
  ).bind(now.toISOString(), sessionId).run();
}

// Revocación por token (logout): idempotente, no revela existencia.
export async function revokeSessionByToken(env, token, now = new Date()) {
  const tokenHash = await hashSessionToken(token);
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(now.toISOString(), tokenHash).run();
}

// Revocación global de una cuenta (recovery, compromiso, cambio de stamp).
export async function revokeAllSessions(env, accountId, now = new Date()) {
  await env.DB.prepare(
    "UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL"
  ).bind(now.toISOString(), accountId).run();
}

// Rotación: valida la actual, crea token+sesión nuevas y revoca la vieja.
// La sesión anterior queda inutilizable (anti replay / fixation: el token
// pre-autenticación jamás se reutiliza). Devuelve null si no había sesión.
export async function rotateSession(request, env, ctx = null, now = new Date()) {
  const session = await getAuthenticatedSession(request, env, ctx, now);
  if (!session.authenticated) return null;

  const created = await createSession(env, session.accountId, {
    userAgent: userAgentBounded(request),
    ipSubset: ipSubset(request),
  });
  await revokeSession(env, session.sessionId, now);
  return { ...created, accountId: session.accountId, previousSessionId: session.sessionId };
}

// Logout: revoca cada cookie válida presente (soporta duplicados) y siempre
// emite cookie de limpieza. Seguro ante cookie ausente, inválida, revocada
// o expirada: comportamiento y respuesta uniformes.
export async function destroySession(request, env, now = new Date()) {
  for (const token of parseSessionTokens(request)) {
    await revokeSessionByToken(env, token, now);
  }
  return { cookie: buildSessionClearCookie() };
}

// CSRF (04.2 §20): para métodos mutantes con cookie, el Origin debe estar
// en la allowlist efectiva (mismo origen del deployment; localhost solo en
// dev). `null` (ausente) se acepta — los clientes same-origin no siempre lo
// envían y SameSite=Lax ya bloquea el envío cross-site de la cookie; el
// string "null" (sandbox/navegación opaca) se RECHAZA para operaciones
// sensibles.
export function isStateChangingAllowed(request, allowedOrigin) {
  const origin = request.headers.get("Origin");
  if (origin === null) return true;
  if (origin === "null") return false;
  return origin === allowedOrigin;
}
