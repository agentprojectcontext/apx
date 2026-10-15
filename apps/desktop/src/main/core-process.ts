// The installed app carries its own core (resources/apx) and runs it on Electron's Node: the owner installs one
// thing and APX works. A core already answering on the port (a checkout run with `pnpm dev`) is used instead.
import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Exit code the core uses to ask for a restart (see apps/core/src/updates.ts). */
const RESTART_CODE = 75;
const READY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
/** A log this big starts again (the old one kept as core.log.1), like the core does with a log it owns. */
const ROTATE_BYTES = 20 * 1024 * 1024;

export type EmbeddedCore = { stop(): void };

export async function isUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the bundled core and keeps it alive (restarted with backoff if it dies) until stop(). Its output goes straight
 * into `logFile`, the home's core.log, which the core then knows not to write a second time.
 */
export function startEmbeddedCore(opts: { resources: string; logFile: string; cacheDir: string }): EmbeddedCore {
  const root = path.join(opts.resources, "apx");
  const build = readBuild(root);
  fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
  if ((fs.statSync(opts.logFile, { throwIfNoEntry: false })?.size ?? 0) > ROTATE_BYTES)
    fs.renameSync(opts.logFile, `${opts.logFile}.1`);
  const log = fs.openSync(opts.logFile, "a");
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
        stdio: ["ignore", log, log],
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
    child.on("exit", (code) => {
      try {
        fs.writeSync(log, `${new Date().toISOString()} core exited (${code})\n`);
      } catch {
        // The log is a convenience: a full disk must not stop the core coming back.
      }
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
      fs.closeSync(log);
    },
  };
}

/** Waits until the core answers, or gives up. */
export async function waitUp(url: string, ms = READY_MS): Promise<boolean> {
  const until = Date.now() + ms;
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
