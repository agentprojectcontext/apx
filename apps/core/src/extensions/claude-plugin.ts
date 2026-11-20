// A Claude Code plugin (`.claude-plugin/plugin.json`, `skills/`, `.mcp.json`, `agents/*.md`) turned into an APX
// extension, in memory: its skills as they are, its MCP servers (`${VAR}` becoming a sensitive setting), its agents as
// manifest 2 agents, its license and readme kept. Commands and hooks have no APX counterpart and are left out.
// Converting happens only under a license that allows it (DECISIONS.md#d-243).
import { createHash } from "node:crypto";
import { CATALOG } from "../integrations/catalog.ts";

/** The licenses whose terms allow a converted copy for the owner's own use (the license file travels with it). */
const ALLOWED = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "MPL-2.0", "Unlicense", "CC0-1.0"];

/** A license by its SPDX id (a manifest's `license`) or by the words of its file; undefined when it is none of these. */
export function licenseOf(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const t = text.trim();
  const id = ALLOWED.find((a) => a.toLowerCase() === t.toLowerCase());
  if (id) return id;
  if (/Permission is hereby granted, free of charge/i.test(t)) return "MIT";
  if (/Apache License/i.test(t) && /Version 2\.0/i.test(t)) return "Apache-2.0";
  if (/Redistribution and use in source and binary forms/i.test(t))
    return /Neither the name/i.test(t) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/or distribute this software/i.test(t)) return "ISC";
  if (/Mozilla Public License,? (version|v\.?) ?2\.0/i.test(t)) return "MPL-2.0";
  if (/This is free and unencumbered software released into the public domain/i.test(t)) return "Unlicense";
  if (/CC0 1\.0 Universal/i.test(t)) return "CC0-1.0";
  return undefined;
}

const LICENSE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];

/** The license of a plugin's files: its own license file, else what its plugin.json says, else the repository's. */
export function pluginLicense(files: Map<string, Buffer>, repoLicense?: string): string | undefined {
  for (const f of LICENSE_FILES) {
    const got = files.get(f);
    if (got) return licenseOf(got.toString("utf8"));
  }
  try {
    const p = JSON.parse(files.get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}") as { license?: unknown };
    if (typeof p.license === "string") return licenseOf(p.license);
  } catch {}
  return licenseOf(repoLicense);
}

/** The version a plugin's plugin.json gives, if any. */
export function pluginVersion(files: Map<string, Buffer>): string | undefined {
  try {
    const p = JSON.parse(files.get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}") as { version?: unknown };
    return typeof p.version === "string" && p.version.length <= 40 ? p.version : undefined;
  } catch {
    return undefined;
  }
}

/** An id APX takes: lowercase letters, digits, "_" and "-", up to 20 characters. */
export const extensionId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 20)
    .replace(/[-_]+$/, "") || "plugin";

/** A name inside an extension (a server, a setting): no "-", so `<id>-<name>` splits one way. */
const innerName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20) || "server";

/** `---` frontmatter and the body after it. */
function frontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv?.[1]) meta[kv[1]] = (kv[2] ?? "").replace(/^["']|["']$/g, "");
  }
  return { meta, body: (m[2] ?? "").trim() };
}

type Setting = {
  name: string;
  label: string;
  type: "string";
  sensitive: boolean;
  required?: boolean;
  default?: string;
};

/** Short words that are words, not acronyms. */
const WORDS = new Set([
  "key",
  "app",
  "and",
  "for",
  "the",
  "use",
  "log",
  "set",
  "run",
  "max",
  "min",
  "new",
  "old",
  "tag",
]);

/** `DD_API_KEY` → "DD API key": short words kept as acronyms, the rest in lowercase, the first capitalised. */
const labelOf = (name: string) =>
  name
    .split(/_+/)
    .filter(Boolean)
    .map((w, i) => {
      const word = w.length <= 3 && !WORDS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase();
      return i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    })
    .join(" ")
    .slice(0, 120) || name;

/** A placeholder that names a key, a token or a password: kept as a secret. */
const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

function knownOAuth(url: string) {
  const target = URL.parse(url)?.href;
  if (!target) return undefined;
  return CATALOG.find((e) => {
    const s = e.server;
    return (
      "command" in s &&
      s.command === "npx" &&
      s.args[0] === "-y" &&
      s.args[1] === "mcp-remote" &&
      URL.parse(s.args[2] ?? "")?.href === target
    );
  });
}

type Server = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
};

/**
 * Its MCP servers: `.mcp.json`, or what plugin.json names under `mcpServers` (a file in the plugin, several, or the
 * servers themselves).
 */
function serversOf(files: Map<string, Buffer>, declared: unknown, left: string[]): Record<string, Server> {
  const read = (rel: string): Record<string, Server> => {
    const f = rel.replace(/^\.\//, "");
    const data = files.get(f);
    if (!data) return {};
    try {
      const raw = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
      if (raw.mcpServers && typeof raw.mcpServers === "object") return raw.mcpServers as Record<string, Server>;
      // Claude Code also takes the servers at the top, without `mcpServers`.
      return Object.fromEntries(
        Object.entries(raw).filter(([, s]) => s && typeof s === "object" && ("command" in s || "url" in s)),
      ) as Record<string, Server>;
    } catch {
      left.push(f);
      return {};
    }
  };
  if (typeof declared === "string") return read(declared);
  if (Array.isArray(declared))
    return Object.assign({}, ...declared.filter((d): d is string => typeof d === "string").map(read));
  if (declared && typeof declared === "object") return declared as Record<string, Server>;
  return read(".mcp.json");
}

/** Turns a plugin's files into an extension's: what is added, and what was left out and why. */
export function convertPlugin(
  files: Map<string, Buffer>,
  /** From the catalog that lists it: its id there and the name it shows, which win over plugin.json's. */
  fallback: { id?: string; name: string; description?: string; version?: string },
): { files: Map<string, Buffer>; id: string; left: string[] } {
  const out = new Map<string, Buffer>();
  const left: string[] = [];
  let plugin: { name?: string; version?: string; description?: string; mcpServers?: unknown } = {};
  try {
    plugin = JSON.parse(files.get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}");
  } catch {}
  const name = fallback.id ? fallback.name : (plugin.name ?? fallback.name);
  const id = fallback.id ?? extensionId(name);
  // Keep explicitly named shared plugin directories without importing unrelated or hidden files.
  const shared = new Set<string>();
  for (const [f, data] of files) {
    if (!/^skills\/[^/]+\/SKILL\.md$/.test(f)) continue;
    const text = data.toString("utf8");
    for (const match of text.matchAll(/(?:\$\{CLAUDE_PLUGIN_ROOT\}|(?<!\.\.\/)\.\.\/\.\.)\/([A-Za-z0-9_-]+)\//g)) {
      const root = match[1];
      if (root && root !== "skills" && root !== "commands" && root !== "hooks") shared.add(root);
    }
  }
  let skills = false;
  for (const [f, data] of files) {
    if (f.startsWith("skills/")) {
      const content = /^skills\/[^/]+\/SKILL\.md$/.test(f)
        ? Buffer.from(
            data
              .toString("utf8")
              .replace(/(?<!\.\.\/)\.\.\/\.\.\/([A-Za-z0-9_-]+)\//g, (whole, root: string) =>
                shared.has(root) ? `{{skill_dir}}/../../${root}/` : whole,
              )
              .replaceAll("$" + "{CLAUDE_PLUGIN_ROOT}", "{{skill_dir}}/../.."),
          )
        : data;
      out.set(f, content);
      skills = true;
    } else if (/^(LICENSE|LICENCE|COPYING|NOTICE)(\.(md|txt))?$/i.test(f) || f === "README.md") out.set(f, data);
    else if (f.startsWith("commands/") || f.startsWith("hooks/")) left.push(f.split("/")[0] ?? f);
    else if (shared.has(f.split("/")[0] ?? "") && !f.split("/").some((part) => part.startsWith("."))) out.set(f, data);
  }
  // Its MCP servers; `${VAR}` in them becomes a setting the owner types once, sensitive when it names a key.
  const servers = serversOf(files, plugin.mcpServers, left);
  const legacyNames = new Map<string, Set<string>>();
  for (const match of JSON.stringify(servers).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g)) {
    const name = match[1] ?? "";
    const old = innerName(name);
    const names = legacyNames.get(old) ?? new Set<string>();
    names.add(name);
    legacyNames.set(old, names);
  }
  const settings = new Map<string, Setting>();
  const settingNames = new Map<string, string>();
  const ref = (v: string) =>
    v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, n: string, fallback: string | undefined) => {
      let s = settingNames.get(n);
      if (!s) {
        s =
          /^[A-Z][A-Z0-9_]{0,19}$/.test(n) && legacyNames.get(innerName(n))?.size === 1
            ? n.toLowerCase()
            : `x_${createHash("sha256").update(n).digest("hex").slice(0, 18)}`;
        if ([...settingNames.values()].includes(s)) throw new Error("plugin setting identifiers collide");
        settingNames.set(n, s);
      }
      const sensitive = SENSITIVE.test(n);
      settings.set(s, {
        name: s,
        label: labelOf(n),
        type: "string",
        sensitive,
        // `${X:-…}` says it may be left out; a plain `${X}` is needed.
        required: fallback === undefined,
        ...(!sensitive && fallback ? { default: fallback } : {}),
      });
      return `${sensitive ? "secret" : "setting"}://${s}`;
    });
  const mcp: Record<string, Record<string, unknown>> = {};
  for (const [n, s] of Object.entries(servers)) {
    const key = innerName(n);
    if (s.command) {
      mcp[key] = {
        command: ref(s.command),
        args: (s.args ?? []).map(ref),
        env: Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, ref(String(v))])),
      };
    } else if (s.url?.startsWith("https://")) {
      const bridge = Object.keys(s.headers ?? {}).length === 0 ? knownOAuth(s.url)?.server : undefined;
      mcp[key] =
        bridge && "command" in bridge
          ? { command: bridge.command, args: [...bridge.args], env: { ...bridge.env } }
          : {
              url: ref(s.url),
              headers: Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, v]) => [k, ref(String(v))])),
            };
    } else left.push(`mcp ${n}`);
  }
  // Its agents (agents/*.md with name and description in their frontmatter) as ready-made agents.
  const agents = [...files]
    .filter(([f]) => /^agents\/[^/]+\.md$/.test(f))
    .slice(0, 10)
    .map(([f, data]) => {
      const { meta, body } = frontmatter(data.toString("utf8"));
      return {
        id: innerName(meta.name ?? f.slice(7, -3)),
        name: (meta.name ?? f.slice(7, -3)).slice(0, 60),
        description: (meta.description ?? "").slice(0, 500),
        prompt: body.slice(0, 20_000) || (meta.description ?? meta.name ?? "Help."),
      };
    })
    .filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);
  const v2 = agents.length > 0 || settings.size > 0;
  const manifest = {
    ...(v2 ? { manifest: 2 } : {}),
    id,
    name: name.slice(0, 80),
    version: (plugin.version ?? fallback.version ?? "0.0.0").slice(0, 40),
    description: (plugin.description ?? fallback.description ?? "").slice(0, 500),
    ...(skills ? { skills: "skills" } : {}),
    mcp,
    ...(settings.size ? { settings: [...settings.values()] } : {}),
    ...(agents.length ? { agents } : {}),
  };
  out.set("apx-extension.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  return { files: out, id, left: [...new Set(left)] };
}
