// Which MCP servers an agent may use: the owner's global ones (settings) and a project's own (`.apc/mcps.json`).
// A project file can name any command, so its servers start only once the owner approved that exact definition.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Store } from "../domain/store.ts";
import { extSecret, SECRET_REF } from "../extensions/extensions.ts";
import { NO_GLOBALS } from "../skills/skills.ts";

export type McpDef = {
  name: string;
  scope: "global" | "project";
  project_id?: string | undefined;
  /** An owner's server run for one project with that project's own variables (they win over the global ones). */
  values_of?: string | undefined;
  command?: string | undefined;
  args: string[];
  env: Record<string, string>;
  url?: string | undefined;
  headers: Record<string, string>;
  enabled: boolean;
  /** Folder a stdio server starts in (the project's). */
  cwd?: string | undefined;
  /** An owner's server that runs only in this project (v1's per-project servers come in like this). */
  only?: string | undefined;
  /** One the owner added in APX (not a project's file nor an extension's): the owner can edit it. */
  own?: boolean | undefined;
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
  project?: unknown;
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
      // A whole value or inside text ("Bearer secret://token"): always the extension's own secret, never the owner's.
      const own = (v: string) => v.replace(SECRET_REF, (_m, n: string) => `secret://${extSecret(e.id, n)}`);
      const map = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, own(v)]));
      const raw: Raw = {
        ...(server.command
          ? { command: server.command.startsWith("./") ? path.join(e.dir, server.command) : server.command }
          : {}),
        args: server.args.map(own),
        env: map(server.env),
        ...(server.url ? { url: own(server.url) } : {}),
        headers: map(server.headers),
      };
      const d = toDef(`${e.id}-${name}`, raw, { scope: "global", cwd: e.dir });
      return d ? [d] : [];
    }),
  );
}

export function mcpConfig(store: Store) {
  const trustKey = (project: string, name: string) => `mcp_trust:${project}:${name}`;
  const cfg = {
    global(): McpDef[] {
      return [
        ...Object.entries(parse(store.settings.get("mcp_servers"))).flatMap(([n, r]) => {
          const d = toDef(n, r, { scope: "global" });
          const only = typeof r.project === "string" && r.project ? r.project : undefined;
          return d ? [{ ...d, own: true, ...(only ? { only } : {}) }] : [];
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
    /** Global servers the owner turned off inside a project (all of them when it takes none). */
    offIn(projectId: string): string[] {
      const list = store.settings.read("mcp_off")[projectId] ?? [];
      return list.includes(NO_GLOBALS) ? cfg.global().map((d) => d.name) : list;
    },
    /** Whether a project takes the owner's global servers at all. */
    takesGlobals(projectId: string): boolean {
      return !store.settings.read("mcp_off")[projectId]?.includes(NO_GLOBALS);
    },
    setOn(projectId: string, name: string, on: boolean): void {
      const all = store.settings.read("mcp_off");
      const list = new Set(all[projectId] ?? []);
      if (on) list.delete(name);
      else list.add(name);
      all[projectId] = [...list];
      store.settings.write("mcp_off", all);
    },
    /** Adds, replaces or (null) removes a server in a project's .apc/mcps.json, keeping the rest of the file. */
    setProject(projectId: string, name: string, server: Record<string, unknown> | null): void {
      const p = store.projects.get(projectId);
      if (!p?.path) throw new Error(`project ${projectId} has no folder`);
      const dir = path.join(p.path, ".apc");
      const file = path.join(dir, "mcps.json");
      if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error(".apc is a link: not written");
      if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
        throw new Error("mcps.json is a link: not written");
      let doc: Record<string, unknown> = {};
      try {
        doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      } catch {}
      const servers = { ...((doc.mcpServers as Record<string, unknown> | undefined) ?? {}) };
      if (server) {
        // What the dialog does not edit (a client's own keys) stays; what it does is replaced as a whole.
        const {
          command: _c,
          args: _a,
          env: _e,
          url: _u,
          headers: _h,
          type: _t,
          ...rest
        } = (servers[name] ?? {}) as Record<string, unknown>;
        servers[name] = { ...rest, ...server };
      } else delete servers[name];
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ ...doc, mcpServers: servers }, null, 2)}\n`);
    },
    /** Adds, replaces or (null) removes one of the owner's global servers. */
    setGlobal(name: string, server: Record<string, unknown> | null): void {
      const all = parse(store.settings.get("mcp_servers"));
      // As in a project's file: what the dialog does not edit (the project it is limited to) stays.
      if (server) {
        const {
          command: _c,
          args: _a,
          env: _e,
          url: _u,
          headers: _h,
          type: _t,
          enabled: _o,
          ...rest
        } = all[name] ?? {};
        all[name] = { ...rest, ...server } as Raw;
      } else delete all[name];
      store.settings.set("mcp_servers", JSON.stringify({ mcpServers: all }));
    },
  };
  return cfg;
}

export type McpConfig = ReturnType<typeof mcpConfig>;
