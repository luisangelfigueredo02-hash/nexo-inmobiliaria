# recovery/reconstructed — NEXO 05.4

Representación versionada, reproducible y mantenible del Worker REAL de producción (`d5a61b95-5f33-41b2-b2c3-317da62ec872`).

## Alcance
- `worker.js`: reconstruido determinísticamente desde el entry del bundle de producción (imports restaurados, helpers esbuild (`__name`, `__defProp`) eliminados, `PUBLIC_CODE_RE2` → `PUBLIC_CODE_RE`, escapes `\x..` decodificados, `/* @__PURE__ */` limpio, `export default {}` restaurado). Script: 05.4-FASE5 (ver `_reconstruction-ops.json` para bitácora de transformaciones).
- `rate-limit.js`, `session-runtime.js`, `src/auth/authorization/*.js`: copias verificadas de HEAD `24e0982` (EXCEPTO identificadores tree-shaken de sesión que nunca se ejecutan en producción).
- `wrangler.toml`: alineado a producción (bindings D1/R2/Vectorize/AI/Assets identicos a `script-settings.json`; `WHATSAPP_PHONE` = valor público de producción `+5358385702`).
- `build-evidence/wrangler-dry-run-worker.js`: salida real de `wrangler deploy --dry-run` (62.42 KiB, todos los bindings correctos).
- NO incluye `public/` (los assets se preservaron por separado en 04.7/04.8 con comandos dedicados).

## Reconstrucción
```
node_modules/.bin/esbuild recovery/reconstructed/worker.js --bundle --format=esm --target=es2023 --outfile=rec-rebuilt.js
```
Comparada al bundle de producción: rutas/SQL EQUAL, identificadores EQUAL modulo helpers esbuild (`__name`,`__defProp`). Ver `recovery/analysis/behavior-eq-check.json`.

## NO-tocar
El artefacto original: `recovery/production-d5a61b95/worker/original/` — NUNCA modificar (hashes en `hashes/hash-manifest.txt`).

## Restricciones (05.4)
NO deploy, NO migration, NO D1/R2/Vectorize writes, NO main touch, NO push.
