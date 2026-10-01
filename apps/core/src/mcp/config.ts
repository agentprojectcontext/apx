// Which MCP servers an agent may use: the owner's global ones (settings) and a project's own (`.apc/mcps.json`).
// A project file can name any command, so its servers start only once the owner approved that exact definition.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { extSecret } from "../extensions/extensions.ts";

export type McpDef = {
  name: string;
  scope: "global" | "project";
  project_id?: string | undefined;
  command?: string | undefined;
  args: string[];
  env: Record<string, string>;
  url?: string | undefined;
  headers: Record<string, string>;
  enabled: boolean;
  /** Folder a stdio server starts in (the project's). */
  cwd?: string | undefined;
  /** Stable fingerprint of what would run: an approval is for this exact definition. */
  hash: string;
};

type Raw = {
  command?: unknown;
  args?: unknown;
  env?: unknown;
  url?: unknown;
  type?: unknown;
  headers?: unknown;
  enabled?: unknown;
  disabled?: unknown;
};

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,40}$/;
const strings = (v: unknown): Record<string, string> =>
  v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)]))
    : {};

function parse(text: string | undefined): Record<string, Raw> {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as { mcpServers?: Record<string, Raw> };
    return j.mcpServers && typeof j.mcpServers === "object" ? j.mcpServers : {};
  } catch {
    return {};
  }
}

function toDef(name: string, r: Raw, base: Pick<McpDef, "scope" | "project_id" | "cwd">): McpDef | undefined {
  if (!NAME.test(name)) return undefined;
  // A repo's file must not be able to send the owner's stored secrets anywhere: only the owner's servers use them.
  if (base.scope === "project" && JSON.stringify([r.env, r.headers, r.args, r.url]).includes("secret://"))
    return undefined;
  const command = typeof r.command === "string" ? r.command : undefined;
  const url = typeof r.url === "string" ? r.url : undefined;
  if (!command && !url) return undefined;
  const args = Array.isArray(r.args) ? r.args.map(String) : [];
  const env = strings(r.env);
  const headers = strings(r.headers);
  const hash = createHash("sha256")
    .update(JSON.stringify({ command, args, env, url, headers }))
    .digest("hex")
    .slice(0, 16);
  return {
    name,
    ...base,
    command,
    args,
    env,
    url,
    headers,
    enabled: r.enabled !== false && r.disabled !== true,
    hash,
  };
}

/** A project file, read without following a symlink out of the repo. */
function readProjectFile(root: string): string | undefined {
  const file = path.join(root, ".apc", "mcps.json");
  try {
    if (fs.lstatSync(file).isSymbolicLink() || fs.lstatSync(path.join(root, ".apc")).isSymbolicLink()) return undefined;
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** An enabled extension's servers, as the owner's own: its secrets renamed to its own, relative commands to its folder. */
function extensionDefs(store: Store): McpDef[] {
  return store.extensions.enabled().flatMap((e) =>
    Object.entries(e.manifest.mcp).flatMap(([name, server]) => {
      const own = (v: string) => v.replace(/^secret:\/\/(.+)$/, (_m, n: string) => `secret://${extSecret(e.id, n)}`);
      const map = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, own(v)]));
      const raw: Raw = {
        ...(server.command
          ? { command: server.command.startsWith("./") ? path.join(e.dir, server.command) : server.command }
          : {}),
        args: server.args.map(own),
        env: map(server.env),
        ...(server.url ? { url: server.url } : {}),
        headers: map(server.headers),
      };
      const d = toDef(`${e.id}-${name}`, raw, { scope: "global", cwd: e.dir });
      return d ? [d] : [];
    }),
  );
}

export function mcpConfig(store: Store) {
  const trustKey = (project: string, name: string) => `mcp_trust:${project}:${name}`;
  return {
    global(): McpDef[] {
      return [
        ...Object.entries(parse(store.settings.get("mcp_servers"))).flatMap(([n, r]) => {
          const d = toDef(n, r, { scope: "global" });
          return d ? [d] : [];
        }),
        ...extensionDefs(store),
      ];
    },
    project(projectId: string): McpDef[] {
      const p = store.projects.get(projectId);
      if (!p?.path || !p.present) return [];
      return Object.entries(parse(readProjectFile(p.path))).flatMap(([n, r]) => {
        const d = toDef(n, r, { scope: "project", project_id: projectId, cwd: p.path });
        return d ? [d] : [];
      });
    },
    /** The owner's own servers are trusted; a project's only for the definition the owner approved. */
    trusted(d: McpDef): boolean {
      return d.scope === "global" || (!!d.project_id && store.settings.get(trustKey(d.project_id, d.name)) === d.hash);
    },
    setTrust(d: McpDef, trusted: boolean): void {
      if (!d.project_id) return;
      store.settings.set(trustKey(d.project_id, d.name), trusted ? d.hash : "");
    },
    /** Adds, replaces or (null) removes one of the owner's global servers. */
    setGlobal(name: string, server: Record<string, unknown> | null): void {
      const all = parse(store.settings.get("mcp_servers"));
      if (server) all[name] = server as Raw;
      else delete all[name];
      store.settings.set("mcp_servers", JSON.stringify({ mcpServers: all }));
    },
  };
}

export type McpConfig = ReturnType<typeof mcpConfig>;
