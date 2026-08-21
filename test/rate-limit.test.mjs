import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";
import { LIMIT_DEF } from "../rate-limit.js";

/* =========================================================
   Mock D1 como SQLite in-memory con captura SQL.
   Soporta: CREATE, INSERT ... ON CONFLICT, SELECT, DELETE.
========================================================= */

// Estado del mock: rows de rate_limits + __aiCalls
function makeEnv() {
  const rows = [];
  const captured = [];
  const state = { aiCalls: 0 };

  const statement = (sql) => {
    const call = { sql, binds: [] };
    captured.push(call);
    return {
      bind(...args) { call.binds = args; return this; },
      async all() { return { results: [] }; },
      async first() {
        if (/SELECT requests, expiry FROM rate_limits/.test(sql)) {
          const key = call.binds[0];
          const wstart = call.binds[1];
          const row = rows.find(r => r.key === key && r.window_start === wstart);
          return row || null;
        }
        return null;
      },
      async run() {
        if (/CREATE TABLE/.test(sql)) return { meta: {} };
        if (/INSERT INTO rate_limits/.test(sql)) {
          const [key, wstart] = call.binds;
          const row = rows.find(r => r.key === key && r.window_start === wstart);
          if (row) row.requests += 1;
          else rows.push({ key, window_start: wstart, requests: 1, expiry: call.binds[3] });
          captured[0].binds = [];
          return { meta: {} };
        }
        if (/DELETE FROM rate_limits/.test(sql)) {
          for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].expiry < call.binds[0]) rows.splice(i, 1);
          }
          return { meta: {} };
        }
        return { meta: {} };
      }
    };
  };

  return {
    DB: { prepare: (sql) => statement(sql) },
    AI: { async run() { state.aiCalls += 1; return { response: "ok" }; } },
    __captured: captured,
    __rows: rows,
    __state: state,
    __LIMIT_IP: "203.0.113.7"
  };
}


const BASE = "https://ratelimit.test";

function chatReq(ip) {
  return new Request(BASE + "/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": ip
    },
    body: JSON.stringify({ message: "casa en La Habana" })
  });
}


/* =========================================================
   RATE LIMIT — 1..8
========================================================= */

test("1. request permitido", async () => {
  const env = makeEnv();
  const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
  assert.equal(res.status, 200);
});

test("2. límite alcanzado → conteo exacto hasta MAX", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
    assert.equal(res.status, 200, `request ${i} debería pasar`);
  }
  const total = env.__rows[0]?.requests || 0;
  assert.equal(total, LIMIT_DEF.max);
});

test("3. excedido → HTTP 429", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
  assert.equal(res.status, 429);
});

test("4. Retry-After ≥ 1 segundo", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
  const retry = Number(res.headers.get("retry-after"));
  assert.ok(retry >= 1);
  assert.ok(retry <= LIMIT_DEF.window);
});

test("5. requests posteriores bloqueadas durante ventana", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  for (let i = 0; i < 5; i++) {
    const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
    assert.equal(res.status, 429);
  }
});

test("6. nueva ventana permite request", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  // Simular que la ventana expiró
  env.__rows.length = 0;
  const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
  assert.equal(res.status, 200);
});

test("7. AI no se invoca cuando el límite fue excedido", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  const before = env.__state.aiCalls;
  await worker.fetch(chatReq(env.__LIMIT_IP), env);
  assert.equal(env.__state.aiCalls, before, "AI llamó aún en 429");
});

test("8. respuesta 429 no contiene secretos/internos", async () => {
  const env = makeEnv();
  for (let i = 0; i < LIMIT_DEF.max; i++) {
    await worker.fetch(chatReq(env.__LIMIT_IP), env);
  }
  const res = await worker.fetch(chatReq(env.__LIMIT_IP), env);
  assert.equal(res.status, 429);
  const data = await res.json();
  const body = JSON.stringify(data);
  assert.ok(!/d1|sqlite|schema|token|header/i.test(body));
  assert.ok(data.error);
});
