// The servers this app has used (this computer's APX and remote ones), newest first, so the panel's server list can
// go back to one. Kept beside connection.json; switching still goes through the connector's one way of connecting.
import fs from "node:fs";
import path from "node:path";
import { type Connection, normalizeUrl, parseConnection, validSshTarget } from "./connection.ts";

const FILE = "servers.json";
/** Remote servers kept; this computer's own APX is kept apart, at most once. */
export const MAX_REMOTE_SERVERS = 10;
const NAME_MAX = 80;

export type KnownServer = { connection: Connection; name?: string; used_at: string };

/** What the panel's list shows of one: never the connection itself (no home path, no port). */
export type ServerView = {
  id: string;
  kind: "local" | "remote";
  name?: string;
  host?: string;
  current: boolean;
  /** Whether it answers now; absent for the one in use (the panel knows) and where asking would open a tunnel. */
  online?: boolean;
};

export function serverId(c: Connection): string {
  return c.mode === "local" ? "local" : c.mode === "url" ? `url:${c.url}` : `ssh:${c.target}`;
}

/** Where a remote server is reached, as the list names it: the address's host, or the SSH host without its user. */
export function serverHost(c: Connection): string | undefined {
  if (c.mode === "url") return new URL(c.url).host;
  if (c.mode === "ssh") return c.target.replace(/^[^@]*@/, "").replace(/:\d+$/, "");
  return undefined;
}

/** Only what the connector itself would have saved: an origin, or an SSH target ssh cannot read as an option. */
function connectable(c: Connection): boolean {
  if (c.mode === "url") return normalizeUrl(c.url) === c.url;
  if (c.mode === "ssh") return validSshTarget(c.target) && c.target === c.target.trim();
  return true;
}

function cleanName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, NAME_MAX);
  return name || undefined;
}

export function loadServers(dataDir: string): KnownServer[] {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dataDir, FILE), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const servers: KnownServer[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { connection?: unknown; name?: unknown; used_at?: unknown };
    const connection = parseConnection(entry.connection);
    if (!connection || !connectable(connection)) continue;
    if (typeof entry.used_at !== "string" || Number.isNaN(Date.parse(entry.used_at))) continue;
    const id = serverId(connection);
    if (seen.has(id)) continue;
    seen.add(id);
    const name = cleanName(entry.name);
    servers.push({ connection, ...(name ? { name } : {}), used_at: entry.used_at });
  }
  return capped(servers.sort((a, b) => Date.parse(b.used_at) - Date.parse(a.used_at)));
}

function capped(servers: KnownServer[]): KnownServer[] {
  const local = servers.find((s) => s.connection.mode === "local");
  const remote = servers.filter((s) => s.connection.mode !== "local").slice(0, MAX_REMOTE_SERVERS);
  return servers.filter((s) => s === local || remote.includes(s));
}

/** A list that cannot be written only loses the list: connecting never depends on it. */
function saveServers(dataDir: string, servers: KnownServer[]): void {
  const file = path.join(dataDir, FILE);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(temp, JSON.stringify(servers, null, 2));
    fs.renameSync(temp, file);
  } catch {
    try {
      fs.rmSync(temp, { force: true });
    } catch {}
  }
}

/** The connection just opened goes first; a name it had stays, and the oldest remote ones beyond the cap go. */
export function rememberServer(dataDir: string, c: Connection, now: Date = new Date()): KnownServer[] {
  const servers = loadServers(dataDir);
  if (!connectable(c)) return servers;
  const id = serverId(c);
  const before = servers.find((s) => serverId(s.connection) === id);
  const next = capped([
    { connection: c, ...(before?.name ? { name: before.name } : {}), used_at: now.toISOString() },
    ...servers.filter((s) => s !== before),
  ]);
  saveServers(dataDir, next);
  return next;
}

/** The computer name a server's core reports, kept for when it is not the one in use. */
export function nameServer(dataDir: string, c: Connection, name: unknown): void {
  const clean = cleanName(name);
  if (!clean) return;
  const servers = loadServers(dataDir);
  const known = servers.find((s) => serverId(s.connection) === serverId(c));
  if (!known || known.name === clean) return;
  known.name = clean;
  saveServers(dataDir, servers);
}

/**
 * The list the panel shows, newest first. `probe` says whether one answers now (undefined: not asked); the one in use
 * is never probed, and it is listed even when it was never remembered (an address given when the app started).
 */
export async function serverViews(
  servers: KnownServer[],
  current: Connection | undefined,
  probe: (c: Connection) => Promise<boolean | undefined>,
): Promise<ServerView[]> {
  const currentId = current ? serverId(current) : undefined;
  const all =
    current && !servers.some((s) => serverId(s.connection) === currentId)
      ? [{ connection: current, used_at: "" } as KnownServer, ...servers]
      : servers;
  return Promise.all(
    all.map(async (s): Promise<ServerView> => {
      const id = serverId(s.connection);
      const isCurrent = id === currentId;
      const online = isCurrent ? undefined : await probe(s.connection).catch(() => false);
      const host = serverHost(s.connection);
      return {
        id,
        kind: s.connection.mode === "local" ? "local" : "remote",
        ...(s.name ? { name: s.name } : {}),
        ...(host ? { host } : {}),
        current: isCurrent,
        ...(online === undefined ? {} : { online }),
      };
    }),
  );
}
