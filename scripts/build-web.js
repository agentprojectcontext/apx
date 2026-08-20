#!/usr/bin/env node
// Build the APX admin web bundle into src/interfaces/web/dist/ so the
// daemon's GET / serves the latest UI. Runs in `prepack` (so `npm install
// -g .` / `npm pack` always ship a fresh bundle) and is also exposed as the
// `build:web` script so anyone can re-run it on demand without remembering
// the cd dance.
//
// We deliberately install the web's deps first — the web package.json is
// NOT part of any pnpm workspace, so a fresh clone has no node_modules in
// src/interfaces/web/. The install is idempotent + cached, so re-runs are
// fast when nothing changed.
//
// SKIP it with APX_SKIP_WEB_BUILD=1 (useful for routine dev tarball flows
// that don't touch UI code).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

if (process.env.APX_SKIP_WEB_BUILD) {
  console.log("build-web: skipped (APX_SKIP_WEB_BUILD set)");
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..", "src", "interfaces", "web");

// pnpm preferred (matches the rest of the repo); fall back to npm if pnpm
// isn't on PATH for whoever happens to be packaging.
const PKG_MGR = (() => {
  const probe = spawnSync("pnpm", ["--version"], { stdio: "ignore" });
  return probe.status === 0 ? "pnpm" : "npm";
})();

function run(cmd, args, label) {
  console.log(`build-web: ${label}…`);
  const r = spawnSync(cmd, args, { cwd: WEB_DIR, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`build-web: ${label} failed (exit ${r.status})`);
    process.exit(r.status || 1);
  }
}

run(PKG_MGR, ["install", "--prefer-offline"], `installing web deps via ${PKG_MGR}`);
run(PKG_MGR, ["run", "build"], "vite build");

// ── Precompressed twins ──────────────────────────────────────────────────────
//
// The bundle is ~1.7 MB of JavaScript and the daemon was serving every byte of
// it raw. On loopback nobody notices; over Tailscale — where the connection may
// be relayed through a DERP node on the other side of the planet — it is the
// difference between opening instantly and waiting.
//
// Compressed AT BUILD TIME rather than per request: the file never changes
// between builds, so paying for it once beats paying on every cold load, and
// brotli at its maximum level (far too slow to do on the fly) is worth another
// ~20% over gzip. The daemon picks the right twin from Accept-Encoding and
// falls back to the original when neither exists — a dist built by an older
// version still serves.
const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".webmanifest", ".map", ".txt"]);
// Below about a packet there is nothing to win, and the twin costs a stat.
const MIN_BYTES = 1024;

function precompress(dir) {
  let files = 0;
  let raw = 0;
  let br = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!COMPRESSIBLE.has(ext)) continue;
      const bytes = fs.readFileSync(full);
      if (bytes.length < MIN_BYTES) continue;
      fs.writeFileSync(
        `${full}.br`,
        zlib.brotliCompressSync(bytes, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
          },
        }),
      );
      // gzip as well: every browser takes it, and some corporate middleboxes
      // still strip `br` from Accept-Encoding.
      fs.writeFileSync(`${full}.gz`, zlib.gzipSync(bytes, { level: 9 }));
      files += 1;
      raw += bytes.length;
      br += fs.statSync(`${full}.br`).size;
    }
  };
  try {
    walk(dir);
  } catch (e) {
    // A missing dist is the vite build's problem to report, not this step's.
    console.warn(`build-web: precompress skipped (${e.message})`);
    return;
  }
  const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
  console.log(`build-web: precompressed ${files} files — ${mb(raw)} → ${mb(br)} brotli`);
}

// Called down here, not next to the build: `const` is not hoisted, so calling
// precompress() above its own configuration would hit the temporal dead zone.
precompress(path.join(WEB_DIR, "dist"));
console.log("build-web: dist/ is fresh ✓");
