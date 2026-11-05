import { spawn } from "node:child_process";
import path from "node:path";
import type { RunTimers } from "../apps/core/src/engine/engine.ts";
import { stopTree } from "../apps/core/src/processes.ts";

const TIMEOUT_MS = 15 * 60_000;
const after: RunTimers["after"] = (ms, callback) => {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
};

type CommandOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  after?: RunTimers["after"];
};

/** Await the owned process group, not just the package manager, before reusing sandbox listeners. */
export async function coverageCommand(command: string, args: string[], options: CommandOptions): Promise<boolean> {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  let timedOut = false;
  let interrupted = false;
  let stopping: Promise<void> | undefined;
  const stop = () => (stopping ??= child.pid ? stopTree(child.pid) : Promise.resolve());
  const interrupt = () => {
    interrupted = true;
    void stop();
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const cancel = (options.after ?? after)(TIMEOUT_MS, () => {
    timedOut = true;
    console.error(`${command} timed out after ${TIMEOUT_MS} ms`);
    void stop();
  });
  try {
    const passed = await new Promise<boolean>((resolve) => {
      child.once("error", (error) => {
        console.error(error.message);
        resolve(false);
      });
      child.once("exit", (code) => resolve(code === 0));
    });
    await stop();
    if (interrupted) throw new Error(`${command} interrupted`);
    return passed && !timedOut;
  } finally {
    cancel();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await stop();
  }
}

type Suites = { web: boolean | string; desktop: boolean };
type SuiteOptions = {
  root: string;
  raw: string;
  snapshot: (directory: string) => void;
  ports: () => Promise<Record<string, string>>;
  run?: typeof coverageCommand;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

/** Local coverage uses the same three complete Playwright shards as CI, without raising per-command deadlines. */
export async function runE2ESuites(which: Suites, options: SuiteOptions): Promise<boolean> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const pnpm = platform === "win32" ? "pnpm.cmd" : "pnpm";
  const run = async (command: string, args: string[]) =>
    (options.run ?? coverageCommand)(command, args, {
      cwd: options.root,
      env: {
        ...env,
        ...(await options.ports()),
        APX_TEST_COVERAGE: "1",
        APX_TEST_COVERAGE_DIR: options.raw,
        NODE_V8_COVERAGE: options.raw,
      },
    });
  if (!(await run(pnpm, ["build:web"]))) return true;
  options.snapshot(path.join(options.root, "apps/web/dist"));
  options.snapshot(path.join(options.root, "packages/ui/dist"));
  let failed = false;
  if (which.web) {
    const shards = typeof which.web === "string" ? [which.web] : ["1/3", "2/3", "3/3"];
    for (const shard of shards) {
      if (!(await run(pnpm, ["exec", "playwright", "test", "--project", "chromium", `--shard=${shard}`])))
        failed = true;
    }
  }
  if (!which.desktop) return failed;
  if (!(await run(pnpm, ["--filter", "@apx/desktop", "build"]))) return true;
  options.snapshot(path.join(options.root, "apps/desktop/dist"));
  const desktop = ["exec", "playwright", "test", "--project", "desktop"];
  let passed: boolean;
  if (platform === "linux" && !env.DISPLAY) {
    const launch =
      'command -v openbox >/dev/null || { echo "Install openbox for desktop window tests" >&2; exit 1; }; openbox >/dev/null 2>&1 & exec "$@"';
    passed = await run("xvfb-run", ["-a", "sh", "-c", launch, "apx-desktop", pnpm, ...desktop]);
  } else if (platform === "darwin") {
    passed = await run("caffeinate", ["-d", "-i", pnpm, ...desktop]);
  } else passed = await run(pnpm, desktop);
  return failed || !passed;
}
