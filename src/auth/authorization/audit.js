/* =========================================================
   NEXO — AUTHORIZATION AUDIT (04.5)
   Adapter append-only sobre audit_events (04.0 #13). Eventos:
   authorization_denied / authorization_sensitive_allowed.
   WHO/WHAT/RESOURCE/WHEN/RESULT/WHY (04.4 §17).

   JAMÁS registra: tokens, cookies, Authorization headers,
   passwords, hashes ni secretos. La emisión es best-effort y
   fuera del critical path (ctx.waitUntil): un fallo de audit
   se loguea, nunca convierte una decisión en ALLOW ni rompe la
   respuesta (la decisión ya se tomó fail-closed).
========================================================= */

function ipSubset(request) {
  const ip = request && request.headers ? request.headers.get("CF-Connecting-IP") : null;
  if (!ip) return null;
  if (ip.includes(".")) return ip.split(".").slice(0, 3).join(".") + ".0/24";
  const segs = ip.split(":").filter(s => s !== "");
  return segs.slice(0, 4).join(":") + "::/64";
}

function userAgentBounded(request) {
  const ua = request && request.headers ? request.headers.get("User-Agent") : null;
  return ua ? ua.slice(0, 200) : null;
}

// Sanitiza metadata: solo escalares, sin claves sensibles.
function sanitizeMetadata(metadata) {
  const out = {};
  for (const [k, v] of Object.entries(metadata || {})) {
    if (/token|secret|password|cookie|authorization/i.test(k)) continue;
    if (v == null || ["string", "number", "boolean"].includes(typeof v)) out[k] = v;
  }
  return out;
}

export async function emitAuthorizationAudit(env, ctx, {
  actor,
  action,
  resourceType = null,
  resourceId = null,
  decision,
  reason = null,
  request = null,
  correlationId = null,
  metadata = {},
}) {
  if (!env || !env.DB) return;
  const event = decision === "ALLOW" ? "authorization_sensitive_allowed" : "authorization_denied";
  const meta = JSON.stringify(sanitizeMetadata({
    ...metadata,
    decision,
    reason,
    ...(actor && actor.plane ? { admin_plane: actor.plane } : {}),
  }));
  const write = env.DB.prepare(
    `INSERT INTO audit_events
       (id, actor_id, actor_type, action, resource_type, resource_id, metadata, correlation_id, actor_ip_subset, actor_user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    actor && actor.accountId != null ? actor.accountId : null,
    actor && actor.type ? actor.type : "anonymous",
    String(action),
    resourceType,
    resourceId != null ? String(resourceId) : null,
    meta,
    correlationId,
    ipSubset(request),
    userAgentBounded(request),
    new Date().toISOString()
  ).run().catch(err => console.error("authz audit write failed:", err && err.message ? err.message : err));

  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(write);
  else await write;
}
