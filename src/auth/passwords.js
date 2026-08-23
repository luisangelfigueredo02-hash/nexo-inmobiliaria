// Password hashing con PBKDF2-SHA256 (WebCrypto nativo, cero dependencias).
// Decisión de producto (FASE 07): la spec 04.0 era passwordless-first, pero
// magic link requiere un proveedor de email que no existe en este producto
// vendible. Email+password PBKDF2 funciona íntegramente en Workers.
// Formato almacenado: pbkdf2$<iteraciones>$<salt b64url>$<hash b64url>

// Cloudflare Workers rechaza PBKDF2 con iteraciones > 100000 (NotSupportedError
// verificado en producción). 100k es el máximo soportado y sigue siendo sólido.
const ITERATIONS = 100000;
const KEY_BITS = 256;

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function pbkdf2(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations }, keyMaterial, KEY_BITS
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored || "").split("$");
    if (scheme !== "pbkdf2" || !iterStr || !saltB64 || !hashB64) return false;
    const iterations = parseInt(iterStr, 10);
    const salt = fromB64url(saltB64);
    const expected = fromB64url(hashB64);
    const actual = await pbkdf2(password, salt, iterations);
    if (actual.length !== expected.length) return false;
    // Comparación constante en tiempo (timing-safe).
    let diff = 0;
    for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function isPasswordValid(password) {
  return typeof password === "string" && password.length >= 8 && password.length <= 128;
}
