// What the terminal knows without asking the core: where its home is, the core.env file, and how to reach it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_ENV_FILE, parseCoreEnv, serializeCoreEnv } from "@apx/protocol";

export const apxHome = (env: NodeJS.ProcessEnv = process.env) => {
  const home = path.resolve(env.APX_HOME || path.join(os.homedir(), ".apx", "v2"));
  return fs.existsSync(home) ? fs.realpathSync(home) : home;
};

export const coreEnvPath = (home: string) => path.join(home, CORE_ENV_FILE);

export function readCoreEnvFile(home: string): Record<string, string> {
  try {
    return parseCoreEnv(fs.readFileSync(coreEnvPath(home), "utf8"));
  } catch {
    return {};
  }
}

/** The file holds the core's token: only the owner may read it. */
export function writeCoreEnvFile(home: string, vars: Record<string, string>): void {
  fs.mkdirSync(home, { recursive: true });
  const file = coreEnvPath(home);
  fs.writeFileSync(file, serializeCoreEnv(vars), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/** The port the core listens on: the environment, then core.env, then the default. */
export function corePort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.APX_PORT || readCoreEnvFile(apxHome(env)).APX_PORT || 7440);
}

/** The local core's URL and token; the token comes from core.env when the environment has none. */
export function localConnection(env: NodeJS.ProcessEnv = process.env): { url: string; token?: string } {
  const url = env.APX_URL ?? `http://127.0.0.1:${corePort(env)}`;
  const token = env.APX_TOKEN || readCoreEnvFile(apxHome(env)).APX_TOKEN;
  return token ? { url, token } : { url };
}

export async function coreUp(url: string): Promise<boolean> {
  try {
    return (await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

export async function waitForCore(url: string, ms = 30_000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await coreUp(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Service commands always address this machine, regardless of the CLI's RPC connection. */
export function serviceConnection(env: NodeJS.ProcessEnv = process.env): { url: string; token?: string } {
  return localConnection({ ...env, APX_URL: undefined });
}
