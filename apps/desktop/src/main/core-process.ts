import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RESTART_CODE = 75;
const READY_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const ROTATE_BYTES = 20 * 1024 * 1024;

export type EmbeddedCore = { stop(): Promise<void> };

export async function isUp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Supervises only the bundled child at the explicit local home/port, never an endpoint supplied by APX_URL. */
export function startEmbeddedCore(opts: {
  resources: string;
  logFile: string;
  cacheDir: string;
  home: string;
  port: number;
  restartDelayMs?: number;
}): EmbeddedCore {
  const root = path.join(opts.resources, "apx");
  const build = readBuild(root);
  fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
  if ((fs.statSync(opts.logFile, { throwIfNoEntry: false })?.size ?? 0) > ROTATE_BYTES)
    fs.renameSync(opts.logFile, `${opts.logFile}.1`);
  const log = fs.openSync(opts.logFile, "a");
  let child: ChildProcess | undefined;
  let stopped = false;
  let retry: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;
  let backoff = opts.restartDelayMs ?? 1000;

  const start = () => {
    if (stopped) return;
    const startedAt = Date.now();
    child = spawn(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", path.join(root, "apps", "core", "src", "main.ts")],
      {
        cwd: root,
        stdio: ["ignore", log, log],
        windowsHide: true,
        env: {
          ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("APX_"))),
          APX_HOST: "127.0.0.1",
          ELECTRON_RUN_AS_NODE: "1",
          NODE_COMPILE_CACHE: opts.cacheDir,
          APX_APP: "",
          APX_HOME: path.resolve(opts.home),
          APX_PORT: String(opts.port),
          APX_WEB_DIST: path.join(root, "apps", "web", "dist"),
          APX_UPDATES: "app",
          APX_SUPERVISED: "1",
          APX_CODE_SHA: build.sha ?? "",
        },
      },
    );
    const finished = (code: number | null) => {
      if (stopped) return;
      fs.writeSync(log, `${new Date().toISOString()} core exited (${code})\n`);
      if (Date.now() - startedAt > 60_000 || code === RESTART_CODE) backoff = opts.restartDelayMs ?? 1000;
      retry = setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    };
    child.once("exit", finished);
    child.once("error", () => finished(null));
  };
  start();
  return {
    stop() {
      if (stopping) return stopping;
      stopped = true;
      clearTimeout(retry);
      stopping = new Promise<void>((resolve) => {
        const close = () => {
          fs.closeSync(log);
          resolve();
        };
        if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return close();
        const current = child;
        const force = setTimeout(() => current.kill("SIGKILL"), 5000);
        current.once("exit", () => {
          clearTimeout(force);
          close();
        });
        current.kill();
      });
      return stopping;
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
