#!/usr/bin/env node
// The e2e gate: the Playwright suite against a daemon of its OWN.
//
// `pnpm e2e` in the panel drives whatever daemon answers on :7430 — on a
// developer's machine that is the live install, with its real projects, real
// conversations and real config. Two things follow, and both are wrong for a
// gate:
//
//   1. It is not what a new user sees. The add-project dialog that closed itself
//      over /inbox was reported from a machine with NO projects; a suite that
//      only ever runs against a busy ~/.apx cannot see that screen at all.
//   2. It writes into the owner's data. Every mutating spec lands in the live
//      daemon, and a crashed run leaves its throwaway registered there.
//
// So this script builds the world the gate runs in, every time:
//
//   - a fresh APX_HOME (a first install: no projects, no agents, no config);
//   - a daemon booted from THIS checkout on its own port (never 7430), so the
//     code under test is the code in the working tree — not the main
//     checkout's, not the npm tarball's;
//   - the PRODUCTION bundle (scripts/build-web.js → dist), served by that
//     daemon, which is what ships. No vite, so no shared dep cache with a dev
//     server someone already has open (see two-vite-servers in the rules);
//   - an `apx` shim on PATH pointing at this checkout, for global-setup.
//
// Then it runs Playwright and tears everything down, whatever happened.
//
//   node scripts/e2e-gate.js              # the whole suite
//   node scripts/e2e-gate.js 26-journeys  # extra args go to `playwright test`
//
// Env: APX_E2E_PORT (default 7530), APX_E2E_SKIP_BUILD=1 to reuse an existing
// dist, APX_E2E_KEEP=1 to leave the temp home behind for inspection.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WEB_DIR = path.join(ROOT, "src", "interfaces", "web");
const PORT = parseInt(process.env.APX_E2E_PORT || "7530", 10);
const BASE = `http://127.0.0.1:${PORT}`;

function log(msg) {
  console.log(`e2e-gate: ${msg}`);
}

async function health() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

async function main() {
  // A daemon already answering here belongs to someone else — possibly a
  // previous gate run that died. Refuse instead of testing against it.
  if (await health()) {
    console.error(`e2e-gate: something already answers on ${BASE}. Stop it, or set APX_E2E_PORT.`);
    return 1;
  }

  if (!process.env.APX_E2E_SKIP_BUILD) {
    log("building the web bundle");
    const b = spawnSync(process.execPath, [path.join(ROOT, "scripts", "build-web.js")], { stdio: "inherit" });
    if (b.status !== 0) return b.status || 1;
  }
  if (!fs.existsSync(path.join(WEB_DIR, "dist", "index.html"))) {
    console.error("e2e-gate: no src/interfaces/web/dist — the daemon would not serve the panel.");
    return 1;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apx-e2e-gate-"));
  const home = path.join(tmp, "home");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  const shim = path.join(bin, "apx");
  fs.writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${path.join(ROOT, "src", "interfaces", "cli", "index.js")}" "$@"\n`);
  fs.chmodSync(shim, 0o755);

  // Playwright looks for its browsers under HOME, and HOME is about to move to
  // the throwaway. Pin the cache the developer (or CI) actually installed into.
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || (
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Caches", "ms-playwright")
      : process.platform === "win32"
        ? path.join(process.env.LOCALAPPDATA || os.homedir(), "ms-playwright")
        : path.join(os.homedir(), ".cache", "ms-playwright")
  );

  const env = {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsers,
    HOME: home,
    USERPROFILE: home,
    APX_HOME: path.join(home, ".apx"),
    APX_PORT: String(PORT),
    APX_HOST: "127.0.0.1",
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
  };

  // The one thing seeded into the fresh home: the super-agent on the `mock`
  // engine. A first install has no model, and a journey that sends a message
  // (which is what creates the chat thread the inbox then mirrors into the URL)
  // needs one — `mock` answers offline, instantly, with no key and no network.
  // Everything else starts empty, the way a new user's machine does.
  fs.mkdirSync(env.APX_HOME, { recursive: true });
  fs.writeFileSync(
    path.join(env.APX_HOME, "config.json"),
    JSON.stringify({ super_agent: { enabled: true, model: "mock" } }, null, 2),
  );

  const daemonLog = path.join(tmp, "daemon.log");
  const out = fs.openSync(daemonLog, "a");
  log(`booting a daemon on ${BASE} with APX_HOME=${env.APX_HOME}`);
  const daemon = spawn(process.execPath, [path.join(ROOT, "src", "host", "daemon", "index.js")], {
    env,
    stdio: ["ignore", out, out],
  });

  let code = 1;
  try {
    let up = null;
    for (let i = 0; i < 60 && !up; i++) {
      if (daemon.exitCode !== null) break;
      up = await health();
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) {
      console.error("e2e-gate: the daemon never became healthy. Its log:");
      console.error(fs.readFileSync(daemonLog, "utf8").slice(-4000));
      return 1;
    }
    log(`daemon up (home_id ${up.home_id})`);

    const r = spawnSync("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)], {
      cwd: WEB_DIR,
      stdio: "inherit",
      env: { ...env, APX_DAEMON_URL: BASE, APX_WEB_URL: BASE, APX_E2E_EXTERNAL_SERVER: "1" },
    });
    code = r.status ?? 1;
    if (code !== 0) log(`daemon log kept at ${daemonLog}`);
  } finally {
    daemon.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => { daemon.kill("SIGKILL"); r(); }, 12_000);
      daemon.once("exit", () => { clearTimeout(t); r(); });
      if (daemon.exitCode !== null) { clearTimeout(t); r(); }
    });
    fs.closeSync(out);
    if (code === 0 && !process.env.APX_E2E_KEEP) fs.rmSync(tmp, { recursive: true, force: true });
    else log(`temp home kept at ${tmp}`);
  }
  log(code === 0 ? "PASSED" : `FAILED (exit ${code})`);
  return code;
}

main().then((c) => process.exit(c), (e) => {
  console.error(e);
  process.exit(1);
});
