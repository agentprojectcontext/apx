// The installed app carries its own core (resources/apx) and runs it on Electron's Node: the owner installs one
// thing and APX works. A core already answering on the port (a checkout run with `pnpm dev`) is used instead.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Exit code the core uses to ask for a restart (see apps/core/src/updates.ts). */
const RESTART_CODE = 75;
const READY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export type EmbeddedCore = { stop(): void };

export async function isUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Starts the bundled core and keeps it alive (restarted with backoff if it dies) until stop(). */
export function startEmbeddedCore(opts: { resources: string; logDir: string; cacheDir: string }): EmbeddedCore {
  const root = path.join(opts.resources, "apx");
  const build = readBuild(root);
  fs.mkdirSync(opts.logDir, { recursive: true });
  const log = fs.createWriteStream(path.join(opts.logDir, "core.log"), { flags: "a" });
  let child: ChildProcess | undefined;
  let stopped = false;
  let backoff = 1000;

  const start = () => {
    const startedAt = Date.now();
    child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(root, "apps", "core", "src", "main.ts")],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          NODE_COMPILE_CACHE: opts.cacheDir,
          APX_WEB_DIST: path.join(root, "apps", "web", "dist"),
          APX_UPDATES: "off",
          APX_SUPERVISED: "1",
          ...(build.sha ? { APX_CODE_SHA: build.sha } : {}),
        },
      },
    );
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    child.on("exit", (code) => {
      log.write(`${new Date().toISOString()} core exited (${code})\n`);
      if (stopped) return;
      // A core that ran a while and then died starts again at once; one that keeps dying waits longer each time.
      if (Date.now() - startedAt > 60_000 || code === RESTART_CODE) backoff = 1000;
      setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });
  };
  start();
  return {
    stop() {
      stopped = true;
      child?.kill();
    },
  };
}

/** Waits until the core answers, or gives up after READY_MS. */
export async function waitUp(url: string): Promise<boolean> {
  const until = Date.now() + READY_MS;
  while (Date.now() < until) {
    if (await isUp(url)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function readBuild(root: string): { version?: string; sha?: string } {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "build.json"), "utf8")) as { version?: string; sha?: string };
  } catch {
    return {};
  }
}
