import test from "node:test";
import assert from "node:assert/strict";

import worker from "../worker.js";

/* Regresión 14E: negociación WebP en /media/*.
   Cubre el bug histórico headers.set("Vary") sin valor (500 en producción)
   y la matriz Accept × existencia de variantes. */

function req(path, headers = {}) {
  return new Request(`https://nexo.dev${path}`, { method: "GET", headers });
}

function makeBucket({ variants = [], originalType = "image/jpeg" } = {}) {
  const keys = new Set(variants);
  const obj = (type) => ({
    body: new Uint8Array([1, 2, 3]),
    httpEtag: "etag-1",
    writeHttpMetadata(h) { h.set("content-type", type); }
  });
  return {
    async get(key) {
      if (keys.has(key)) return obj("image/webp");
      if (!/-w\d+\.webp$/.test(key)) return obj(originalType);
      return null;
    },
    async head(key) { return this.get(key); }
  };
}

const env = (bucket) => ({ BUCKET_IMAGENES: bucket });

test("Accept: image/webp con variante → 200 image/webp + Vary: Accept", async () => {
  const bucket = makeBucket({ variants: ["n001/photo-01-w400.webp", "n001/photo-01-w800.webp"] });
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { accept: "image/avif,image/webp,*/*" }), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("vary"), "Accept");
});

test("Accept: image/webp sin variantes → fallback JPEG, sin Vary", async () => {
  const bucket = makeBucket({ variants: [] });
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { accept: "image/webp" }), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("vary"), null);
});

test("Accept: image/avif (sin soporte) → original JPEG", async () => {
  const bucket = makeBucket({ variants: ["n001/photo-01-w400.webp"] });
  const res = await worker.fetch(req("/media/n001/photo-01.jpg", { accept: "image/avif" }), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
});

test("sin Accept → original JPEG", async () => {
  const bucket = makeBucket({ variants: ["n001/photo-01-w400.webp"] });
  const res = await worker.fetch(req("/media/n001/photo-01.jpg"), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/jpeg");
});

test("archivo inexistente → 404", async () => {
  const bucket = { async get() { return null; }, async head() { return null; } };
  const res = await worker.fetch(req("/media/n999/nope.jpg", { accept: "image/webp" }), env(bucket));
  assert.equal(res.status, 404);
});

test("petición directa a variante webp se sirve tal cual", async () => {
  const bucket = makeBucket({ variants: ["n001/photo-01-w800.webp"] });
  const res = await worker.fetch(req("/media/n001/photo-01-w800.webp", { accept: "image/webp" }), env(bucket));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
});

test("cache headers immutable en media", async () => {
  const bucket = makeBucket({ variants: [] });
  const res = await worker.fetch(req("/media/n001/photo-01.jpg"), env(bucket));
  assert.match(res.headers.get("cache-control"), /immutable/);
});
