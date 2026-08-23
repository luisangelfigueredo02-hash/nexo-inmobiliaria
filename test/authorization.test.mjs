import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { hashSessionToken, generateSessionToken } from "../session-runtime.js";
import {
  PERMISSIONS,
  ROLES,
  ACTOR_TYPES,
  RELATIONSHIPS,
  PUBLIC_GRANTS,
  USER_GRANTS,
  ROLE_GRANTS,
  LEGACY_ADMIN_PLANE,
  LEGACY_ADMIN_PLANE_ACTIONS,
  anonymousActor,
  legacyAdminActor,
  resolveActor,
  authorize,
  DECISION,
  isAllowed,
  classifyListingIdentifier,
  propertyAudienceFor,
  serializeProperty,
  emitAuthorizationAudit,
} from "../src/auth/authorization/index.js";

/* =========================================================
   D1 fake con routing por patrón SQL + captura de statements.
   Estado por test (sin globals). failOn: regex → la ejecución
   lanza (simula caída de D1 para fail-closed).
========================================================= */

const LISTING_A = { id: 9, public_code: "N-001", status: "draft", created_by: "user-a" };
const LISTING_PUB = { id: 10, public_code: "N-002", status: "published", created_by: "user-a" };

function makeState(overrides = {}) {
  return {
    properties: [LISTING_A, LISTING_PUB],
    listingOwners: [{ listing_id: 9, account_id: "user-a", relationship: "owner", revoked_at: null }],
    userRoles: [],
    accounts: [{ id: "user-a", status: "active", security_stamp: "s1" }],
    sessions: [],
    auditEvents: [],
    ...overrides,
  };
}

function makeDb(state, opts = {}) {
  const captured = [];
  const norm = (sql) => sql.replace(/\s+/g, " ").trim();
  return {
    captured,
    prepare(sql) {
      const call = { sql: norm(sql), binds: [] };
      captured.push(call);
      const guard = () => {
        if (opts.failOn && opts.failOn.test(call.sql)) throw new Error("D1 simulated failure");
      };
      return {
        bind(...args) { call.binds = args; return this; },
        async first() { guard(); return routeFirst(call.sql, call.binds, state); },
        async all() { guard(); return { results: routeAll(call.sql, call.binds, state) }; },
        async run() { guard(); routeRun(call.sql, call.binds, state); return { meta: { changes: 1 } }; },
      };
    },
  };
}

function routeFirst(sql, binds, state) {
  // Fidelidad mínima con D1: los SELECT públicos filtran status='published'.
  const onlyPublished = /status = 'published'/.test(sql);
  const matchListing = (p) => !onlyPublished || p.status === "published";
  if (/FROM properties WHERE public_code = \?/.test(sql)) {
    const row = state.properties.find(p => p.public_code === binds[binds.length - 1]);
    return row && matchListing(row) ? row : null;
  }
  if (/FROM properties WHERE id = \?/.test(sql)) {
    const id = binds[binds.length - 1];
    const row = state.properties.find(p => String(p.id) === String(id));
    return row && matchListing(row) ? row : null;
  }
  if (/FROM listing_owners/.test(sql)) {
    const [listingId, accountId] = binds;
    return state.listingOwners.find(o =>
      String(o.listing_id) === String(listingId) && o.account_id === accountId && o.revoked_at === null
    ) || null;
  }
  if (/FROM sessions s JOIN accounts a/.test(sql)) {
    const tokenHash = binds[binds.length - 1];
    const s = state.sessions.find(x => x.token_hash === tokenHash && x.revoked_at === null);
    if (!s) return null;
    const a = state.accounts.find(x => x.id === s.account_id);
    if (!a) return null;
    return {
      id: s.id, account_id: s.account_id, expires_at: s.expires_at, last_seen_at: s.last_seen_at || null,
      account_status: a.status, account_security_stamp: a.security_stamp,
    };
  }
  return null;
}

function routeAll(sql, binds, state) {
  if (/FROM user_roles WHERE account_id = \?/.test(sql)) {
    return state.userRoles
      .filter(r => r.account_id === binds[binds.length - 1] && r.revoked_at === null)
      .map(r => ({ role: r.role }));
  }
  if (/FROM properties/.test(sql)) return [...state.properties];
  return [];
}

function routeRun(sql, binds, state) {
  if (/INSERT INTO audit_events/.test(sql)) {
    state.auditEvents.push({
      id: binds[0], actor_id: binds[1], actor_type: binds[2], action: binds[3],
      resource_type: binds[4], resource_id: binds[5], metadata: binds[6], correlation_id: binds[7],
    });
  }
}

/* ---- Actores de conveniencia (construidos server-side) ---- */

function userActor(accountId, roles = []) {
  return { type: ACTOR_TYPES.USER, accountId, sessionId: "sess-1", roles, plane: null, rolesError: false };
}

const ref = (r) => ({ type: "property", ref: r });

async function decision(actor, action, resource, state, opts) {
  const env = { DB: makeDb(state, opts) };
  return authorize(actor, action, resource, { env });
}

/* =========================================================
   1. DENY BY DEFAULT (04.5 §7)
========================================================= */

test("deny-by-default: actor inválido/ausente → DENY", async () => {
  for (const actor of [null, undefined, {}, { type: "root" }, "admin"]) {
    const d = await decision(actor, PERMISSIONS.PROPERTY_READ_PUBLIC, ref("N-001"), makeState());
    assert.equal(d.decision, DECISION.DENY);
    assert.equal(d.reason, "invalid_actor");
  }
});

test("deny-by-default: acción fuera del catálogo → DENY", async () => {
  const d = await decision(userActor("user-a"), "property.publish", ref("N-001"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "unknown_action");
});

test("deny-by-default: acción con scope sin recurso → DENY", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, null, makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "resource_required");
});

test("deny-by-default: recurso inexistente → DENY resource_not_found", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-999"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "resource_not_found");
});

test("decisión jamás es undefined/null/truthy ambiguo", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_CREATE, null, makeState());
  assert.ok([DECISION.ALLOW, DECISION.DENY].includes(d.decision));
  assert.equal(typeof d.reason, "string");
});

/* =========================================================
   2. FAIL CLOSED (04.5 §8)
========================================================= */

test("fail-closed: error de D1 en resource lookup → DENY (no throw)", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), makeState(), { failOn: /FROM properties/ });
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "resource_lookup_failed");
});

test("fail-closed: error de D1 en ownership lookup → DENY", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), makeState(), { failOn: /FROM listing_owners/ });
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "ownership_lookup_failed");
});

test("fail-closed: error previo de role lookup (rolesError) → DENY", async () => {
  const actor = { ...userActor("user-a", [ROLES.ADMIN]), rolesError: true };
  const d = await decision(actor, PERMISSIONS.USER_SUSPEND, { type: "account" }, makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "role_resolution_failed");
});

test("fail-closed: sin binding DB → DENY", async () => {
  const d = await authorize(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), { env: {} });
  assert.equal(d.decision, DECISION.DENY);
});

/* =========================================================
   3. PUBLIC / ANONYMOUS (04.5 §12, §45)
========================================================= */

test("anonymous: read_public sobre published → ALLOW", async () => {
  const d = await decision(anonymousActor(), PERMISSIONS.PROPERTY_READ_PUBLIC, ref("N-002"), makeState());
  assert.equal(d.decision, DECISION.ALLOW);
});

test("anonymous: read_public sobre draft → DENY (invisible)", async () => {
  const d = await decision(anonymousActor(), PERMISSIONS.PROPERTY_READ_PUBLIC, ref("N-001"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "resource_not_public");
});

test("anonymous: cualquier mutación → DENY authentication_required", async () => {
  for (const action of [PERMISSIONS.PROPERTY_CREATE, PERMISSIONS.PROPERTY_UPDATE, PERMISSIONS.PROPERTY_DELETE, PERMISSIONS.PROPERTY_SUBMIT]) {
    const d = await decision(anonymousActor(), action, ref("N-002"), makeState());
    assert.equal(d.decision, DECISION.DENY, action);
    assert.equal(d.reason, "authentication_required", action);
  }
});

test("anonymous: moderation/admin actions → DENY", async () => {
  for (const action of [PERMISSIONS.MODERATION_APPROVE, PERMISSIONS.USER_SUSPEND, PERMISSIONS.CONFIG_UPDATE]) {
    const d = await decision(anonymousActor(), action, ref("N-002"), makeState());
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("anonymous: config.read → ALLOW", async () => {
  const d = await decision(anonymousActor(), PERMISSIONS.CONFIG_READ, { type: "config" }, makeState());
  assert.equal(d.decision, DECISION.ALLOW);
});

/* =========================================================
   4. USER + OWNERSHIP (matriz §12 / 04.5 §9, §18-21)
========================================================= */

test("user: property.create sin recurso → ALLOW (siempre draft)", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_CREATE, null, makeState());
  assert.equal(d.decision, DECISION.ALLOW);
});

test("owner: update/read_private/submit/delete sobre draft propio → ALLOW", async () => {
  for (const action of [PERMISSIONS.PROPERTY_UPDATE, PERMISSIONS.PROPERTY_READ_PRIVATE, PERMISSIONS.PROPERTY_SUBMIT, PERMISSIONS.PROPERTY_DELETE, PERMISSIONS.PROPERTY_ARCHIVE]) {
    const d = await decision(userActor("user-a"), action, ref("N-001"), makeState());
    assert.equal(d.decision, DECISION.ALLOW, action);
    assert.equal(d.relationship, RELATIONSHIPS.OWNER, action);
  }
});

test("owner: delete sobre published → DENY (estado no elegible)", async () => {
  const state = makeState({ listingOwners: [{ listing_id: 10, account_id: "user-a", relationship: "owner", revoked_at: null }] });
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_DELETE, ref("N-002"), state);
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "condition_not_met");
});

test("owner: submit sobre published → DENY (estado no elegible)", async () => {
  const state = makeState({ listingOwners: [{ listing_id: 10, account_id: "user-a", relationship: "owner", revoked_at: null }] });
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_SUBMIT, ref("N-002"), state);
  assert.equal(d.decision, DECISION.DENY);
});

test("agent: update/submit sobre listing gestionado → ALLOW; delete/archive → DENY", async () => {
  const state = makeState({ listingOwners: [{ listing_id: 9, account_id: "agent-1", relationship: "agent", revoked_at: null }] });
  for (const action of [PERMISSIONS.PROPERTY_UPDATE, PERMISSIONS.PROPERTY_SUBMIT, PERMISSIONS.PROPERTY_READ_PRIVATE]) {
    const d = await decision(userActor("agent-1"), action, ref("N-001"), state);
    assert.equal(d.decision, DECISION.ALLOW, action);
  }
  for (const action of [PERMISSIONS.PROPERTY_DELETE, PERMISSIONS.PROPERTY_ARCHIVE]) {
    const d = await decision(userActor("agent-1"), action, ref("N-001"), state);
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("relación revocada (revoked_at) no otorga nada → DENY", async () => {
  const state = makeState({ listingOwners: [{ listing_id: 9, account_id: "user-a", relationship: "owner", revoked_at: "2026-01-01" }] });
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), state);
  assert.equal(d.decision, DECISION.DENY);
});

/* =========================================================
   5. IDOR / BOLA / ESCALACIÓN HORIZONTAL (04.5 §12-14)
========================================================= */

test("IDOR: user B sobre listing de A (id interno y public_code) → DENY indistinguible", async () => {
  for (const r of ["9", "N-001"]) {
    for (const action of [PERMISSIONS.PROPERTY_UPDATE, PERMISSIONS.PROPERTY_DELETE, PERMISSIONS.PROPERTY_READ_PRIVATE, PERMISSIONS.PROPERTY_SUBMIT]) {
      const d = await decision(userActor("user-b"), action, ref(r), makeState());
      assert.equal(d.decision, DECISION.DENY, `${action} ${r}`);
    }
  }
});

test("IDOR: listing ajeno vs inexistente → misma forma de decisión DENY", async () => {
  const ajeno = await decision(userActor("user-b"), PERMISSIONS.PROPERTY_UPDATE, ref("9"), makeState());
  const inexistente = await decision(userActor("user-b"), PERMISSIONS.PROPERTY_UPDATE, ref("999"), makeState());
  assert.equal(ajeno.decision, inexistente.decision);
  assert.equal(typeof ajeno.decision, "string");
});

test("escalación horizontal: mismo rol USER, recurso ajeno → DENY", async () => {
  // user-b autenticado, mismo rol implícito que user-a, sin relación.
  const d = await decision(userActor("user-b"), PERMISSIONS.PROPERTY_DELETE, ref("N-001"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.relationship, null);
});

/* =========================================================
   6. ESCALACIÓN VERTICAL (04.5 §15, §22)
========================================================= */

test("USER sin rol: moderation.* → DENY", async () => {
  for (const action of [PERMISSIONS.MODERATION_REVIEW, PERMISSIONS.MODERATION_APPROVE, PERMISSIONS.MODERATION_REJECT, PERMISSIONS.MODERATION_SUSPEND_LISTING]) {
    const d = await decision(userActor("user-a"), action, ref("N-002"), makeState());
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("USER sin rol: acciones admin → DENY", async () => {
  for (const action of [PERMISSIONS.USER_SUSPEND, PERMISSIONS.ROLE_GRANT_MODERATOR, PERMISSIONS.CONFIG_UPDATE, PERMISSIONS.AUDIT_READ_ALL]) {
    const d = await decision(userActor("user-a"), action, { type: "account" }, makeState());
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("publish directo no existe como permiso: USER jamás publica", async () => {
  const d = await decision(userActor("user-a"), "property.publish", ref("N-001"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  // y la vía de publicación real (moderation.approve) también deniega
  const d2 = await decision(userActor("user-a"), PERMISSIONS.MODERATION_APPROVE, ref("N-001"), makeState());
  assert.equal(d2.decision, DECISION.DENY);
});

/* =========================================================
   7. MODERATOR / ADMIN / SUPERADMIN (matriz §12)
========================================================= */

test("MODERATOR: moderation.* sobre caso existente → ALLOW", async () => {
  for (const action of [PERMISSIONS.MODERATION_REVIEW, PERMISSIONS.MODERATION_APPROVE, PERMISSIONS.MODERATION_REJECT, PERMISSIONS.MODERATION_REQUEST_CHANGES, PERMISSIONS.MODERATION_SUSPEND_LISTING]) {
    const d = await decision(userActor("mod-1", [ROLES.MODERATOR]), action, ref("N-001"), makeState());
    assert.equal(d.decision, DECISION.ALLOW, action);
  }
});

test("MODERATOR: read_internal → ALLOW; editar contenido ajeno → DENY", async () => {
  const readD = await decision(userActor("mod-1", [ROLES.MODERATOR]), PERMISSIONS.PROPERTY_READ_INTERNAL, ref("N-001"), makeState());
  assert.equal(readD.decision, DECISION.ALLOW);
  for (const action of [PERMISSIONS.PROPERTY_UPDATE, PERMISSIONS.PROPERTY_DELETE]) {
    const d = await decision(userActor("mod-1", [ROLES.MODERATOR]), action, ref("N-001"), makeState());
    assert.equal(d.decision, DECISION.DENY, action); // decide, no redacta
  }
});

test("MODERATOR: user.suspend / role.* / config.update → DENY", async () => {
  for (const action of [PERMISSIONS.USER_SUSPEND, PERMISSIONS.ROLE_GRANT_MODERATOR, PERMISSIONS.CONFIG_UPDATE]) {
    const d = await decision(userActor("mod-1", [ROLES.MODERATOR]), action, { type: "account" }, makeState());
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("ADMIN: grants explícitos (moderation, user.suspend, role.grant_moderator, config.update, audit.read_all) → ALLOW", async () => {
  const admin = userActor("admin-1", [ROLES.ADMIN]);
  assert.equal((await decision(admin, PERMISSIONS.MODERATION_APPROVE, ref("N-001"), makeState())).decision, DECISION.ALLOW);
  assert.equal((await decision(admin, PERMISSIONS.USER_SUSPEND, { type: "account" }, makeState())).decision, DECISION.ALLOW);
  assert.equal((await decision(admin, PERMISSIONS.ROLE_GRANT_MODERATOR, { type: "role" }, makeState())).decision, DECISION.ALLOW);
  assert.equal((await decision(admin, PERMISSIONS.CONFIG_UPDATE, { type: "config" }, makeState())).decision, DECISION.ALLOW);
  assert.equal((await decision(admin, PERMISSIONS.AUDIT_READ_ALL, { type: "audit" }, makeState())).decision, DECISION.ALLOW);
});

test("ADMIN: grant_admin no existe en catálogo → DENY (no puede crear admins)", async () => {
  const d = await decision(userActor("admin-1", [ROLES.ADMIN]), "role.grant_admin", { type: "role" }, makeState());
  assert.equal(d.decision, DECISION.DENY);
});

test("ADMIN archiva listing ajeno (grant explícito, sin relationship) → ALLOW", async () => {
  const d = await decision(userActor("admin-1", [ROLES.ADMIN]), PERMISSIONS.PROPERTY_ARCHIVE, ref("N-001"), makeState());
  assert.equal(d.decision, DECISION.ALLOW);
});

test("SUPERADMIN: sin grants operativos diarios → DENY en operación normal", async () => {
  const sa = userActor("root-1", [ROLES.SUPERADMIN]);
  assert.equal((await decision(sa, PERMISSIONS.MODERATION_APPROVE, ref("N-001"), makeState())).decision, DECISION.DENY);
  assert.equal((await decision(sa, PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), makeState())).decision, DECISION.DENY);
});

test("rol desconocido en actor.roles no otorga nada → DENY", async () => {
  const d = await decision(userActor("user-a", ["MEGAADMIN"]), PERMISSIONS.USER_SUSPEND, { type: "account" }, makeState());
  assert.equal(d.decision, DECISION.DENY);
});

/* =========================================================
   8. ROLE / OWNER_ID / PUBLIC_CODE TAMPERING (04.5 §16-17)
========================================================= */

test("role tampering: headers/body/query con role=admin no afectan resolveActor", async () => {
  const state = makeState();
  const token = generateSessionToken();
  state.sessions.push({
    id: "sess-1", account_id: "user-a", token_hash: await hashSessionToken(token),
    expires_at: new Date(Date.now() + 3600e3).toISOString(), revoked_at: null, last_seen_at: null,
  });
  const env = { DB: makeDb(state) };
  const req = new Request("https://nexo.test/api/x?role=ADMIN&accountId=admin-1", {
    headers: {
      Cookie: `__Host-session=${token}`,
      "X-Role": "ADMIN",
      "X-Account-Id": "admin-1",
    },
  });
  const actor = await resolveActor(req, env, null);
  assert.equal(actor.type, ACTOR_TYPES.USER);
  assert.equal(actor.accountId, "user-a"); // de la sesión, no del header
  assert.deepEqual(actor.roles, []); // user_roles vacío: ningún rol por mucho que el cliente lo pida
});

test("resolveActor jamás produce actor system desde HTTP", async () => {
  const env = { DB: makeDb(makeState()) };
  const req = new Request("https://nexo.test/api/x", { headers: { "X-Actor-Type": "system" } });
  const actor = await resolveActor(req, env, null);
  assert.ok([ACTOR_TYPES.ANONYMOUS, ACTOR_TYPES.USER].includes(actor.type));
});

test("owner_id tampering: relationship/owner_id forjados en resource se ignoran", async () => {
  const forged = { type: "property", ref: "N-001", relationship: "owner", owner_id: "user-b", account_id: "user-b" };
  const d = await decision(userActor("user-b"), PERMISSIONS.PROPERTY_UPDATE, forged, makeState());
  assert.equal(d.decision, DECISION.DENY); // listing_owners manda, no el cliente
  assert.equal(d.relationship, null);
});

test("public_code tampering: casing y formato se normalizan, no bypassean", async () => {
  assert.deepEqual(classifyListingIdentifier("n-001"), { column: "public_code", value: "N-001" });
  assert.deepEqual(classifyListingIdentifier("N-001"), { column: "public_code", value: "N-001" });
  assert.deepEqual(classifyListingIdentifier("9"), { column: "id", value: "9" });
  // 'N-001' y '9' resuelven el mismo listing → misma decisión
  const byCode = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001"), makeState());
  const byId = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("9"), makeState());
  assert.equal(byCode.decision, byId.decision);
  assert.equal(byCode.resource.id, byId.resource.id);
});

test("public_code con inyección SQL-like no matchea patrón → tratada como id, sin fila", async () => {
  const d = await decision(userActor("user-a"), PERMISSIONS.PROPERTY_UPDATE, ref("N-001' OR '1'='1"), makeState());
  assert.equal(d.decision, DECISION.DENY);
  assert.equal(d.reason, "resource_not_found");
});

/* =========================================================
   9. SYSTEM ACTOR / PLANO ADMIN LEGADO (04.4 §7/§9)
========================================================= */

test("system legacy plane: acciones enumeradas → ALLOW; resto → DENY", async () => {
  const actor = legacyAdminActor();
  for (const action of LEGACY_ADMIN_PLANE_ACTIONS) {
    const d = await decision(actor, action, null, makeState());
    assert.equal(d.decision, DECISION.ALLOW, action);
  }
  for (const action of [PERMISSIONS.MODERATION_APPROVE, PERMISSIONS.USER_SUSPEND, PERMISSIONS.ROLE_GRANT_MODERATOR]) {
    const d = await decision(actor, action, null, makeState());
    assert.equal(d.decision, DECISION.DENY, action);
  }
});

test("system sin plane reconocido → DENY en todo", async () => {
  const actor = { type: ACTOR_TYPES.SYSTEM, accountId: null, sessionId: null, roles: [], plane: "http_declared", rolesError: false };
  const d = await decision(actor, PERMISSIONS.PROPERTY_CREATE, null, makeState());
  assert.equal(d.decision, DECISION.DENY);
});

/* =========================================================
   10. FIELD-LEVEL / SERIALIZACIÓN POR AUDIENCIA (04.5 §27-31)
========================================================= */

const FULL_ROW = {
  id: 9, public_code: "N-001", title: "Casa", type: "casa", operation: "venta", price: 100,
  currency: "USD",
  province: "La Habana", city: "La Habana", neighborhood: "Vedado", bedrooms: 3, bathrooms: 2,
  area: 120, description: "Desc", images: '["/media/a.jpg"]', latitude: 23.1, longitude: -82.4,
  created_at: "2026-08-01",
  address: "Calle 23 #123", owner_name: "Privado", owner_phone: "555-111",
  internal_notes: "nota interna", status: "draft", created_by: "user-a", contact_email: "x@y.cu",
  password_hash: "no-existe-pero-si-existiera", security_stamp: "stamp", token_hash: "hash",
};

test("public: nunca expone privados ni campos de seguridad", async () => {
  const out = serializeProperty(FULL_ROW, "public");
  assert.deepEqual(Object.keys(out).sort(), [
    "area", "bathrooms", "bedrooms", "city", "created_at", "currency", "description", "id", "images",
    "latitude", "longitude", "neighborhood", "operation", "price", "province", "public_code", "title", "type",
  ].sort());
  assert.deepEqual(out.images, ["/media/a.jpg"]);
});

test("owner: + address/owner_name/owner_phone/status; jamás internal_notes", async () => {
  const out = serializeProperty(FULL_ROW, "owner");
  assert.equal(out.address, "Calle 23 #123");
  assert.equal(out.owner_phone, "555-111");
  assert.equal(out.status, "draft");
  assert.ok(!("internal_notes" in out));
  assert.ok(!("created_by" in out));
  assert.ok(!("contact_email" in out));
});

test("moderator: + internal_notes/created_by; jamás security fields", async () => {
  const out = serializeProperty(FULL_ROW, "moderator");
  assert.equal(out.internal_notes, "nota interna");
  assert.equal(out.created_by, "user-a");
  for (const k of ["password_hash", "security_stamp", "token_hash"]) assert.ok(!(k in out), k);
});

test("admin: campos de decisión; jamás hashes/stamps/tokens", async () => {
  const out = serializeProperty(FULL_ROW, "admin");
  assert.equal(out.owner_name, "Privado");
  for (const k of ["password_hash", "security_stamp", "token_hash", "contact_email"]) assert.ok(!(k in out), k);
});

test("audiencia desconocida → null (fail-closed de serialización)", async () => {
  assert.equal(serializeProperty(FULL_ROW, "godmode"), null);
});

test("audiencia derivada del actor server-side (propertyAudienceFor)", async () => {
  assert.equal(propertyAudienceFor(null), "public");
  assert.equal(propertyAudienceFor(anonymousActor()), "public");
  assert.equal(propertyAudienceFor(userActor("user-a"), "owner"), "owner");
  assert.equal(propertyAudienceFor(userActor("user-a"), "agent"), "owner");
  assert.equal(propertyAudienceFor(userActor("x", [ROLES.MODERATOR])), "moderator");
  assert.equal(propertyAudienceFor(userActor("x", [ROLES.ADMIN])), "admin");
  assert.equal(propertyAudienceFor(legacyAdminActor()), "admin");
  assert.equal(propertyAudienceFor({ type: ACTOR_TYPES.SYSTEM, roles: [], plane: null }), "public");
});

/* =========================================================
   11. AUDIT (04.5 §39-40)
========================================================= */

test("audit: registra evento ALLOW sensible con metadata saneada", async () => {
  const state = makeState();
  const db = makeDb(state);
  await emitAuthorizationAudit({ DB: db }, null, {
    actor: legacyAdminActor(), action: PERMISSIONS.PROPERTY_CREATE, resourceType: "property",
    resourceId: "N-003", decision: "ALLOW", reason: "system_plane", correlationId: "corr-1",
    metadata: { token: "NUNCA", admin_note: "ok" },
  });
  assert.equal(state.auditEvents.length, 1);
  const ev = state.auditEvents[0];
  assert.equal(ev.actor_type, "system");
  assert.equal(ev.actor_id, null); // plano legado: no se falsifica account
  assert.equal(ev.action, "property.create");
  assert.equal(ev.resource_id, "N-003");
  const meta = JSON.parse(ev.metadata);
  assert.equal(meta.admin_plane, "legacy_admin_bearer");
  assert.ok(!("token" in meta));
});

test("audit: fallo de escritura no rompe ni altera la decisión (best-effort)", async () => {
  const db = makeDb(makeState(), { failOn: /INSERT INTO audit_events/ });
  await emitAuthorizationAudit({ DB: db }, null, {
    actor: anonymousActor(), action: "x", decision: "DENY",
  }); // no lanza
});

test("audit: metadata nunca incluye claves sensibles", async () => {
  const state = makeState();
  await emitAuthorizationAudit({ DB: makeDb(state) }, null, {
    actor: userActor("user-a"), action: "x", decision: "DENY",
    metadata: { password: "p", session_token: "t", Authorization: "a", cookie: "c", ok: 1 },
  });
  const meta = JSON.parse(state.auditEvents[0].metadata);
  assert.deepEqual(Object.keys(meta).sort(), ["decision", "ok", "reason"].sort());
});

/* =========================================================
   12. INTEGRIDAD DE LA MATRIZ COMPILADA
========================================================= */

test("matriz: todos los grants son permisos del catálogo; ninguno es property.publish", async () => {
  const { isKnownPermission } = await import("../src/auth/authorization/index.js");
  const all = [...PUBLIC_GRANTS, ...USER_GRANTS, ...LEGACY_ADMIN_PLANE_ACTIONS, ...Object.values(ROLE_GRANTS).flat()];
  for (const p of all) {
    assert.ok(isKnownPermission(p), `grant desconocido: ${p}`);
    assert.notEqual(p, "property.publish");
  }
});

/* =========================================================
   13. INTEGRACIÓN worker.fetch — ENDPOINTS (04.5 §44-46)
========================================================= */

const BASE = "https://nexo.test";
const ADMIN = "secreto-test";

function integrationEnv(state, opts) {
  return { ADMIN_TOKEN: ADMIN, DB: makeDb(state, opts) };
}

test("anonymous → PUT /api/admin/properties/:id → 401", async () => {
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties/9", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "X" }),
  }), integrationEnv(makeState()));
  assert.equal(res.status, 401);
});

test("sesión de usuario NO autentica el plano admin → 401", async () => {
  const state = makeState();
  const token = generateSessionToken();
  state.sessions.push({
    id: "sess-1", account_id: "user-a", token_hash: await hashSessionToken(token),
    expires_at: new Date(Date.now() + 3600e3).toISOString(), revoked_at: null, last_seen_at: null,
  });
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties", {
    headers: { Cookie: `__Host-session=${token}` },
  }), integrationEnv(state));
  assert.equal(res.status, 401);
});

test("GET /api/properties: payload sin campos privados aunque D1 los devuelva", async () => {
  const state = makeState({ properties: [{ ...FULL_ROW, status: "published" }] });
  const res = await worker.fetch(new Request(BASE + "/api/properties"), integrationEnv(state));
  assert.equal(res.status, 200);
  const [prop] = await res.json();
  for (const k of ["owner_name", "owner_phone", "internal_notes", "address", "status", "created_by", "contact_email"]) {
    assert.ok(!(k in prop), `campo filtrado: ${k}`);
  }
  assert.equal(prop.public_code, "N-001");
});

test("GET /api/properties/:id draft → 404 (invisible para público)", async () => {
  // LISTING_A es draft; el endpoint público solo sirve published.
  const state = makeState({ properties: [LISTING_A] });
  const res = await worker.fetch(new Request(BASE + "/api/properties/N-001"), integrationEnv(state));
  assert.equal(res.status, 404);
});

test("admin POST éxito → audit authorization_sensitive_allowed (system/legacy_bearer)", async () => {
  const state = makeState();
  const env = integrationEnv(state);
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties", {
    method: "POST",
    headers: { Authorization: `Bearer ${ADMIN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Casa válida", price: 100 }),
  }), env);
  assert.equal(res.status, 200);
  const ev = state.auditEvents.find(e => e.action === "property.create");
  assert.ok(ev, "audit emitido");
  assert.equal(ev.actor_type, "system");
  assert.equal(JSON.parse(ev.metadata).admin_plane, "legacy_admin_bearer");
  assert.equal(JSON.parse(ev.metadata).decision, "ALLOW");
});

test("admin DELETE éxito → audit con resource_id público", async () => {
  const state = makeState();
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties/9", {
    method: "DELETE", headers: { Authorization: `Bearer ${ADMIN}` },
  }), integrationEnv(state));
  assert.equal(res.status, 200);
  const ev = state.auditEvents.find(e => e.action === "property.delete");
  assert.ok(ev, "audit emitido");
  assert.equal(ev.resource_id, "N-001");
});

test("admin GET lista → serialización admin (privados sí; sin campos de seguridad)", async () => {
  const state = makeState({ properties: [{ ...FULL_ROW, status: "published" }] });
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties", {
    headers: { Authorization: `Bearer ${ADMIN}` },
  }), integrationEnv(state));
  assert.equal(res.status, 200);
  const [prop] = await res.json();
  assert.equal(prop.owner_name, "Privado");
  assert.equal(prop.internal_notes, "nota interna");
  for (const k of ["password_hash", "security_stamp", "token_hash"]) assert.ok(!(k in prop), k);
});

test("bearer inválido → 401 sin audit ni decisión", async () => {
  const state = makeState();
  const res = await worker.fetch(new Request(BASE + "/api/admin/properties", {
    headers: { Authorization: "Bearer malo" },
  }), integrationEnv(state));
  assert.equal(res.status, 401);
  assert.equal(state.auditEvents.length, 0);
});
