// GATE 19: /api/chat consume Workers AI (coste por llamada) — además del límite
// general 20/min debe tener límite estricto scoped (10/5min) como auth-login.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

function makeEnv() {
  const rows = [];
  const statement = (sql) => {
    const call = { sql, binds: [] };
    return {
      bind(...args) { call.binds = args; return this; },
      async all() { return { results: [] }; },
      async first() {
        if (/SELECT requests, expiry FROM rate_limits/.test(sql) || /SELECT requests FROM rate_limits/.test(sql)) {
          const key = call.binds[0];
          const wstart = call.binds[1];
          return rows.find(r => r.key === key && r.window_start === wstart) || null;
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
        }
        return { meta: {} };
      },
    };
  };
  return { DB: { prepare: statement } };
}

test("GATE19: /api/chat aplica límite estricto (429 tras 10 en 5 min)", async () => {
  const env = makeEnv();
  const codes = [];
  for (let i = 0; i < 12; i++) {
    const req = new Request("https://x/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.9" },
      body: JSON.stringify({ message: "hola" }),
    });
    const res = await worker.fetch(req, env, { waitUntil() {} });
    codes.push(res.status);
  }
  const limited = codes.filter(c => c === 429).length;
  assert.ok(limited >= 2, `esperaba >=2 respuestas 429, obtuvo: ${codes.join(",")}`);
});
