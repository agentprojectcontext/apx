// Which APX this app shows: its own core on this computer (server), or one running elsewhere (client: an address, or
// a host reached over SSH). Chosen on the first run of an installed app and kept in the app's data folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CORE_ENV_FILE, parseCoreEnv } from "@apx/protocol";

export type Connection = { mode: "local" } | { mode: "url"; url: string } | { mode: "ssh"; target: string };

const FILE = "connection.json";

export function loadConnection(dataDir: string): Connection | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), "utf8")) as Partial<Connection> & {
      url?: unknown;
      target?: unknown;
    };
    if (c.mode === "local") return { mode: "local" };
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

/** Where the core on this computer logs, however it was started (apps/core/src/core-log.ts). */
export const localCoreLogFile = (env: NodeJS.ProcessEnv = process.env) =>
  path.join(localCoreHome(env), "logs", "core.log");

/** The core's own token on this computer (core.env in its home), when it asks for one. */
export function localCoreToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const home = localCoreHome(env);
  try {
    return parseCoreEnv(fs.readFileSync(path.join(home, CORE_ENV_FILE), "utf8")).APX_TOKEN || undefined;
  } catch {
    return undefined;
  }
}
