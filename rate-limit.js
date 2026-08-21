// Rate limiting Cloudflare-native sobre D1, MVP IP-based.
// Diseñado para ampliar a account-based en 04.1 sin cambio de esquema.

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 20;
export const LIMIT_DEF = Object.freeze({ window: WINDOW_SECONDS, max: MAX_REQUESTS });

const IDENTIFIER = "ip"; // extendible: "account" en 04.1

async function hash(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

// Valor: { limited: bool, retryAfter } — no revela datos internos.
export async function enforceRateLimit(env, request) {
  if (!env.DB) return { limited: false, retryAfter: 0 };
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await hash(`${IDENTIFIER}:${ip}`);
  const windowStart = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
  const expiryTs = (windowStart + 1) * WINDOW_SECONDS;

  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT, window_start INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
        expiry INTEGER NOT NULL, PRIMARY KEY (key, window_start)
      )`).run();
  } catch (err) {
    // Fallo de tabla opuesta → fail-open (disponibilidad), no bloquear al usuario
    console.error("Rate limit infra error:", err.message || err);
    return { limited: false, retryAfter: 0 };
  }

  try {
    const row = await env.DB.prepare(
      "SELECT requests, expiry FROM rate_limits WHERE key = ? AND window_start = ?"
    ).bind(key, windowStart).first();

    const count = row ? row.requests : 0;
    if (count >= MAX_REQUESTS) {
      const retryAfter = Math.max(expiryTs - Math.floor(Date.now() / 1000), 1);
      return { limited: true, retryAfter };
    }

    await env.DB.prepare(`
      INSERT INTO rate_limits (key, window_start, requests, expiry)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(key, window_start) DO UPDATE SET requests = requests + 1
    `).bind(key, windowStart, expiryTs).run();

    // Cada ~50 hits, purga ventanas viejas para no acumular keys en D1 como soul resid
    if ((windowStart % 50) === 0) {
      await env.DB.prepare("DELETE FROM rate_limits WHERE expiry < ?").bind(
        Math.floor(Date.now() / 1000)
      ).run();
    }
    return { limited: false, retryAfter: 0 };
  } catch (err) {
    console.error("Rate limit query error:", err.message || err);
    return { limited: false, retryAfter: 0 };
  }
}

export function rejectResponse(retryAfter, corsHeaders) {
  return new Response(JSON.stringify({ error: "Rate limit excedido" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfter),
      ...corsHeaders
    }
  });
}

export const NO_CACHE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache"
});
