// Which APX this app shows: its own core on this computer (server), or one running elsewhere (client: an address, or
// a host reached over SSH). Chosen on the first run of an installed app and kept in the app's data folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_ENV_FILE, parseCoreEnv } from "@apx/protocol";
import { ApxClient } from "@apx/protocol/client";

type LocalConnection = { mode: "local"; home?: string; port?: number; home_id?: string };
export type Connection = LocalConnection | { mode: "url"; url: string } | { mode: "ssh"; target: string };

const FILE = "connection.json";

export function loadConnection(dataDir: string): Connection | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), "utf8")) as Partial<Connection> & {
      url?: unknown;
      target?: unknown;
      home?: unknown;
      port?: unknown;
      home_id?: unknown;
    };
    if (c.mode === "local") {
      if (c.home === undefined && c.port === undefined && c.home_id === undefined) return { mode: "local" };
      if (
        typeof c.home !== "string" ||
        !path.isAbsolute(c.home) ||
        typeof c.port !== "number" ||
        !Number.isInteger(c.port) ||
        c.port < 1 ||
        c.port > 65535 ||
        typeof c.home_id !== "string" ||
        !c.home_id
      )
        return undefined;
      return { mode: "local", home: c.home, port: c.port, home_id: c.home_id };
    }
    if (c.mode === "url" && typeof c.url === "string") return { mode: "url", url: c.url };
    if (c.mode === "ssh" && typeof c.target === "string") return { mode: "ssh", target: c.target };
  } catch {}
  return undefined;
}

export function saveConnection(dataDir: string, c: Connection): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, FILE), JSON.stringify(c, null, 2));
}

export function forgetConnection(dataDir: string): void {
  fs.rmSync(path.join(dataDir, FILE), { force: true });
}

/** A desktop installed from the local panel retains that exact installation after a restart. */
export function applySavedLocalTarget(dataDir: string, env: NodeJS.ProcessEnv): void {
  if (env.APX_URL || env.APX_HOME || env.APX_PORT) return;
  const target = loadConnection(dataDir);
  if (target?.mode !== "local" || !target.home || !target.port || !target.home_id) return;
  const identity = fs.readFileSync(path.join(target.home, "home-id"), "utf8").trim();
  if (identity !== target.home_id) throw new Error("The saved local APX belongs to another installation");
  env.APX_HOME = target.home;
  env.APX_PORT = String(target.port);
}

/** An address the owner typed: http(s) only, no path, no trailing slash. */
export function normalizeUrl(input: string): string | undefined {
  const text = input.trim();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

/** user@host or host, optionally :port — never anything ssh could read as an option. */
export function validSshTarget(input: string): boolean {
  return /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(input.trim()) && !input.trim().startsWith("-");
}

/** The home of the core on this computer (the core's own default, unless APX_HOME moves it). */
export const localCoreHome = (env: NodeJS.ProcessEnv = process.env) =>
  env.APX_HOME || path.join(os.homedir(), ".apx", "v2");

/** APX_URL selects a connection, never the daemon this computer may start. */
export function localCoreUrl(env: NodeJS.ProcessEnv = process.env): string {
  let port = env.APX_PORT;
  if (!port) {
    try {
      port = parseCoreEnv(fs.readFileSync(path.join(localCoreHome(env), CORE_ENV_FILE), "utf8")).APX_PORT;
    } catch {}
  }
  const n = Number(port || 7440);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error("Invalid local APX_PORT");
  return `http://127.0.0.1:${n}`;
}

export function initialConnection(dataDir: string, env: NodeJS.ProcessEnv = process.env): Connection | undefined {
  if (env.APX_URL) {
    const url = normalizeUrl(env.APX_URL);
    if (!url) throw new Error("Invalid APX_URL");
    return { mode: "url", url };
  }
  return env.APX_CONNECTION === "local" ? { mode: "local" } : loadConnection(dataDir);
}

/** A healthy port alone is not evidence that it belongs to the selected installation. */
export async function verifyLocalCore(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<"matches" | "mismatch" | "missing"> {
  const expected = fs.readFileSync(path.join(localCoreHome(env), "home-id"), "utf8").trim();
  const token = localCoreToken(env);
  const health = await new ApxClient({ url, ...(token ? { token } : {}), timeoutMs: 2000 }).call("system.health", {});
  if (!expected || !health.home_id.trim()) return "missing";
  return health.home_id === expected ? "matches" : "mismatch";
}

/** Where the core on this computer logs, however it was started (apps/core/src/core-log.ts). */
export const localCoreLogFile = (env: NodeJS.ProcessEnv = process.env) =>
  path.join(localCoreHome(env), "logs", "core.log");

/** The core's own token on this computer (core.env in its home), when it asks for one. */
export function localCoreToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env.APX_TOKEN) return env.APX_TOKEN;
  const home = localCoreHome(env);
  try {
    return parseCoreEnv(fs.readFileSync(path.join(home, CORE_ENV_FILE), "utf8")).APX_TOKEN || undefined;
  } catch {
    return undefined;
  }
}
