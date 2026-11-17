// A Claude Code plugin (`.claude-plugin/plugin.json`, `skills/`, `.mcp.json`, `agents/*.md`) turned into an APX
// extension, in memory: its skills as they are, its MCP servers (`${VAR}` becoming a sensitive setting), its agents as
// manifest 2 agents, its license and readme kept. Commands and hooks have no APX counterpart and are left out.
// Converting happens only under a license that allows it (DECISIONS.md#d-243).

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

type Server = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  type?: string;
  url?: string;
  headers?: Record<string, string>;
};

/** Turns a plugin's files into an extension's: what is added, and what was left out and why. */
export function convertPlugin(
  files: Map<string, Buffer>,
  fallback: { name: string; description?: string; version?: string },
): { files: Map<string, Buffer>; id: string; left: string[] } {
  const out = new Map<string, Buffer>();
  const left: string[] = [];
  let plugin: { name?: string; version?: string; description?: string } = {};
  try {
    plugin = JSON.parse(files.get(".claude-plugin/plugin.json")?.toString("utf8") ?? "{}");
  } catch {}
  const name = plugin.name ?? fallback.name;
  const id = extensionId(name);
  // Skills, license and readme as they are.
  let skills = false;
  for (const [f, data] of files) {
    if (f.startsWith("skills/")) {
      out.set(f, data);
      skills = true;
    } else if (/^(LICENSE|LICENCE|COPYING|NOTICE)(\.(md|txt))?$/i.test(f) || f === "README.md") out.set(f, data);
    else if (f.startsWith("commands/") || f.startsWith("hooks/")) left.push(f.split("/")[0] ?? f);
  }
  // Its MCP servers; `${VAR}` in them becomes a sensitive setting the owner types once.
  const settings = new Map<string, { name: string; label: string; type: "string"; sensitive: true }>();
  const ref = (v: string) =>
    v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, n: string) => {
      const s = innerName(n);
      settings.set(s, { name: s, label: n, type: "string", sensitive: true });
      return `secret://${s}`;
    });
  const mcp: Record<string, Record<string, unknown>> = {};
  try {
    const raw = JSON.parse(files.get(".mcp.json")?.toString("utf8") ?? "{}") as { mcpServers?: Record<string, Server> };
    for (const [n, s] of Object.entries(raw.mcpServers ?? {})) {
      const key = innerName(n);
      if (s.command) {
        mcp[key] = {
          command: ref(s.command),
          args: (s.args ?? []).map(ref),
          env: Object.fromEntries(Object.entries(s.env ?? {}).map(([k, v]) => [k, ref(String(v))])),
        };
      } else if (s.url?.startsWith("https://")) {
        mcp[key] = {
          url: ref(s.url),
          headers: Object.fromEntries(Object.entries(s.headers ?? {}).map(([k, v]) => [k, ref(String(v))])),
        };
      } else left.push(`mcp ${n}`);
    }
  } catch {
    if (files.has(".mcp.json")) left.push(".mcp.json");
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
