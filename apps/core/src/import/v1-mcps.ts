// v1's MCP servers (~/.apx/mcps.json and each project's mcps.json in its v1 storage) as the owner's own servers in
// v2: a project's runs only in that project. Values never stay in plain text when they look like a credential.
import fs from "node:fs";
import path from "node:path";

export type V1Mcp = { name: string; server: Record<string, unknown> };

/** A value names a credential when its variable or header does. */
const SECRETISH = /token|key|secret|pass|auth|cookie/i;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The servers of one v1 mcps.json, as v1 wrote them. */
export function v1Mcps(file: string): V1Mcp[] {
  try {
    const doc = obj(JSON.parse(fs.readFileSync(file, "utf8")));
    return Object.entries(obj(doc.mcpServers)).flatMap(([name, s]) =>
      NAME.test(name) && (obj(s).command || obj(s).url) ? [{ name, server: obj(s) }] : [],
    );
  } catch {
    return [];
  }
}

export const v1McpFile = (storage: string) => path.join(storage, "mcps.json");

/** `${var.NAME}` and `${NAME}` (v1's references to its variables) as v2's `secret://NAME`. */
export const v1Refs = (v: string) => v.replace(/\$\{(?:var\.)?([a-zA-Z0-9_.-]+)\}/g, "secret://$1");

/**
 * One v1 server as v2 keeps it: references become secret://, and a credential written in plain text is handed to
 * `keep` (which stores it) and replaced by a reference to it.
 */
export function v2Server(
  m: V1Mcp,
  keep: (name: string, value: string) => void,
  project?: string,
): Record<string, unknown> {
  const own = (key: string, raw: unknown): string => {
    const v = v1Refs(String(raw));
    if (v.includes("secret://") || !SECRETISH.test(key) || /^(https?:\/\/|\/)/.test(v)) return v;
    const scheme = /^(Bearer|Basic|Token)\s+(.+)$/i.exec(v);
    const name = `${m.name}_${key}`
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, "_")
      .slice(0, 64);
    keep(name, scheme?.[2] ?? v);
    return scheme ? `${scheme[1]} secret://${name}` : `secret://${name}`;
  };
  const map = (r: unknown) => Object.fromEntries(Object.entries(obj(r)).map(([k, v]) => [k, own(k, v)]));
  const s = m.server;
  return {
    ...(typeof s.command === "string" ? { command: s.command } : {}),
    args: Array.isArray(s.args) ? s.args.map((a) => v1Refs(String(a))) : [],
    env: map(s.env),
    ...(typeof s.url === "string" ? { url: v1Refs(s.url) } : {}),
    headers: map(s.headers),
    ...(s.enabled === false || s.disabled === true ? { enabled: false } : {}),
    ...(project ? { project } : {}),
  };
}
