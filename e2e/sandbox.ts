// Which sandbox a run talks to: its own free ports and an id only it knows, so a run never reaches a core or a control
// API it did not start (another checkout's sandbox, a scratch core, the owner's APX).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { isInside, realpath } from "../apps/core/src/paths.ts";
import { desktopDataDir } from "../packages/install/src/paths.ts";

export const SANDBOX_PORTS = ["E2E_PORT", "E2E_CONTROL_PORT", "E2E_WA_PORT", "E2E_PAIR_PORT"] as const;

/** Free loopback ports for every sandbox listener; explicit ones remain available for debugging. */
export async function sandboxPorts(env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string>> {
  const ports: Record<string, string> = {};
  const servers: net.Server[] = [];
  try {
    for (const name of SANDBOX_PORTS) {
      if (env[name]) {
        ports[name] = env[name];
        continue;
      }
      const server = net.createServer();
      servers.push(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      ports[name] = String((server.address() as net.AddressInfo).port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  }
}

/**
 * This run's ports and id, chosen once by the runner: workers and the sandbox (e2e/env.ts) inherit them through the
 * environment, so evaluating the config again there keeps the same ones.
 */
export async function claimSandbox(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  Object.assign(env, await sandboxPorts(env));
  env.E2E_RUN ||= randomUUID();
}

/** Whether something already listens on `port` (loopback). */
export function portTaken(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(true));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
  });
}

/** The core at `url` is the one living in `home`: same installation id. */
export async function coreOwnsHome(url: string, home: string): Promise<boolean> {
  try {
    const health = (await (await fetch(`${url}/health`)).json()) as { result?: { home_id?: string } };
    const id = fs.readFileSync(path.join(home, "home-id"), "utf8").trim();
    return Boolean(id) && health.result?.home_id === id;
  } catch {
    return false;
  }
}

/**
 * A desktop app a test launches keeps its data in a temp folder, never the machine's own APX app folder: that one holds
 * the owner's saved connection, and a test that wrote it would open the owner's app on a sandbox core.
 */
export function assertSandboxDesktopData(dataDir: string | undefined): void {
  const machine = desktopDataDir(
    process.platform,
    { APPDATA: process.env.APPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME },
    os.homedir(),
  );
  const temp = realpath(os.tmpdir());
  const real = dataDir && path.isAbsolute(dataDir) ? realOrSelf(dataDir) : undefined;
  if (!real || !isInside(temp, real) || isInside(machine, real) || isInside(real, machine))
    throw new Error(
      `A desktop test must keep APX_DESKTOP_DATA inside ${temp}, never the APX app's own folder (${machine}); got ${dataDir ?? "nothing"}`,
    );
}

/** The real location of a path that may not exist yet: its nearest existing parent's, plus the rest. */
function realOrSelf(p: string): string {
  const missing: string[] = [];
  let at = path.resolve(p);
  while (!fs.existsSync(at)) {
    missing.unshift(path.basename(at));
    const up = path.dirname(at);
    if (up === at) return path.resolve(p);
    at = up;
  }
  return path.join(realpath(at), ...missing);
}
