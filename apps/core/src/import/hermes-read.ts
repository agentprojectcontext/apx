// A Hermes home folder (~/.hermes) read for moving to APX: each profile's identity (SOUL.md), memory, skills folder,
// cron jobs and MCP servers, and the names of what it keeps that APX does not take. Read-only; of .env only the
// variable names are kept, and auth.json is never opened. A link is never followed: it could pull any file of the
// machine (a private key) into an agent's prompt.
import fs from "node:fs";
import path from "node:path";
import { listField, parseFrontmatter } from "../apc/frontmatter.ts";
import { insideReal } from "../paths.ts";
import type { FoundServer } from "./server-secrets.ts";

export type HermesJob = {
  id: string;
  name: string;
  prompt: string;
  schedule: { kind: string; expr?: string; minutes?: number; run_at?: string };
  skills: string[];
  /** Runs a script instead of (or before) the agent: APX's routines do not run Hermes scripts. */
  script: boolean;
};
export type HermesServer = { name: string; server: FoundServer };
export type HermesProfile = {
  /** "default" for the home folder itself. */
  name: string;
  dir: string;
  soul: string;
  personalities: string[];
  /** MEMORY.md's entries (what the agent noted) and USER.md's (about the owner). */
  memory: string[];
  user: string[];
  skills: string | undefined;
  jobs: HermesJob[];
  servers: HermesServer[];
  /** Variable names in .env (values are never read). */
  env: string[];
  /** Other settings APX has no place for, by name: the model, providers, messaging platforms, auth.json. */
  settings: Array<{ name: string; secret: boolean }>;
};

const MARKERS = ["config.yaml", ".env", "SOUL.md", "profile.yaml", "auth.json", "state.db"];
const MAX_FILE = 1024 * 1024;

/** A file or folder of the home itself: not a link, and inside it once its folders' links are resolved. */
const own = (home: string, p: string, kind: "file" | "dir") => {
  try {
    const st = fs.lstatSync(p);
    return (kind === "file" ? st.isFile() : st.isDirectory()) && insideReal(home, p);
  } catch {
    return false;
  }
};

/** A file of the home as text, or "" for a link, a file elsewhere or one too big. */
function read(home: string, file: string): string {
  if (!own(home, file, "file")) return "";
  let fd: number | undefined;
  try {
    // O_NOFOLLOW: a file swapped for a link after the check is still refused.
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const st = fs.fstatSync(fd);
    return st.isFile() && st.size <= MAX_FILE ? fs.readFileSync(fd, "utf8") : "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
const isProfile = (dir: string) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

/** Memory files keep entries separated by a line with `§`. */
const entries = (text: string) =>
  text
    .split(/^\s*§\s*$/m)
    .map((e) => e.trim())
    .filter(Boolean);

/** config.yaml flattened to dotted keys (block style, as Hermes writes it; inline `{…}` maps are not read). */
function config(text: string): Record<string, string | string[]> {
  return text.trim() ? parseFrontmatter(`---\n${text}\n---`).fields : {};
}

/** A list written inline (`["-y", "pkg"]`) or as YAML items. */
function list(v: string | string[] | undefined): string[] {
  if (typeof v === "string" && v.trim().startsWith("["))
    try {
      const parsed = JSON.parse(v) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {}
  return listField(v);
}

function servers(fields: Record<string, string | string[]>): HermesServer[] {
  const by = new Map<string, Record<string, string | string[]>>();
  for (const [k, v] of Object.entries(fields)) {
    const m = /^mcp_servers\.([^.]+)\.(.+)$/.exec(k);
    if (!m?.[1] || !m[2]) continue;
    by.set(m[1], { ...by.get(m[1]), [m[2]]: v });
  }
  return [...by].flatMap(([name, o]) => {
    const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
    const sub = (prefix: string) =>
      Object.fromEntries(
        Object.entries(o)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), String(v)]),
      );
    const command = str("command");
    const url = str("url");
    if (!command === !url) return [];
    const args = list(o.args);
    const env = sub("env.");
    const headers = sub("headers.");
    const server: FoundServer = {
      ...(command ? { command } : { url }),
      ...(args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(headers).length ? { headers } : {}),
    };
    return [{ name, server }];
  });
}

function jobs(text: string): HermesJob[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  // `{jobs: [...]}`, and the older shapes Hermes still loads: a bare list or a map by id.
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const all = Array.isArray(raw) ? raw : Array.isArray(o.jobs) ? o.jobs : Object.values(o);
  return all.flatMap((j) => {
    const r = j && typeof j === "object" ? (j as Record<string, unknown>) : {};
    const s = r.schedule && typeof r.schedule === "object" ? (r.schedule as Record<string, unknown>) : {};
    if (typeof r.id !== "string" || typeof s.kind !== "string") return [];
    const skills = [...(Array.isArray(r.skills) ? r.skills : []), ...(typeof r.skill === "string" ? [r.skill] : [])];
    return [
      {
        id: r.id,
        name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : r.id,
        prompt: typeof r.prompt === "string" ? r.prompt.trim() : "",
        schedule: {
          kind: s.kind,
          ...(typeof s.expr === "string" ? { expr: s.expr } : {}),
          ...(typeof s.minutes === "number" ? { minutes: s.minutes } : {}),
          ...(typeof s.run_at === "string" ? { run_at: s.run_at } : {}),
        },
        skills: skills.map(String),
        script: Boolean(r.script) || Boolean(r.no_agent),
      },
    ];
  });
}

/** Variable names of a .env file; the values stay unread. */
function envNames(text: string): string[] {
  return text.split("\n").flatMap((l) => {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l);
    return m?.[1] ? [m[1]] : [];
  });
}

function profile(home: string, name: string, dir: string): HermesProfile {
  const fields = config(read(home, path.join(dir, "config.yaml")));
  const keys = Object.keys(fields);
  const prefixed = (p: string) => [
    ...new Set(keys.filter((k) => k.startsWith(p)).map((k) => k.slice(p.length).split(".")[0] ?? "")),
  ];
  const model = fields["model.default"] ?? fields.model;
  const settings = [
    ...(typeof model === "string" && model ? [{ name: `model ${model}`, secret: false }] : []),
    ...prefixed("providers.").map((p) => ({ name: `provider ${p}`, secret: true })),
    ...prefixed("platforms.").map((p) => ({ name: `platform ${p}`, secret: false })),
    ...(fs.existsSync(path.join(dir, "auth.json")) ? [{ name: "auth.json", secret: true }] : []),
    ...(["state.db", "sessions"].some((f) => fs.existsSync(path.join(dir, f)))
      ? [{ name: "chat history", secret: false }]
      : []),
  ];
  const skills = path.join(dir, "skills");
  return {
    name,
    dir,
    soul: read(home, path.join(dir, "SOUL.md")).trim(),
    personalities: prefixed("agent.personalities."),
    memory: entries(read(home, path.join(dir, "memories", "MEMORY.md"))),
    user: entries(read(home, path.join(dir, "memories", "USER.md"))),
    skills: own(home, skills, "dir") ? skills : undefined,
    jobs: jobs(read(home, path.join(dir, "cron", "jobs.json"))),
    servers: servers(fields),
    env: envNames(read(home, path.join(dir, ".env"))),
    settings,
  };
}

/** The skills in a skills folder, by their folder's name (links inside it are not followed). */
export function skillsIn(dir: string): string[] {
  try {
    const found = fs
      .readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name === "SKILL.md")
      .map((e) => path.basename(e.parentPath));
    return [...new Set(found)].sort();
  } catch {
    return [];
  }
}

/** The home folder's profiles, the default one first; undefined when the folder is not a Hermes home. */
export function readHermes(home: string): HermesProfile[] | undefined {
  if (!isProfile(home)) return undefined;
  const out = [profile(home, "default", home)];
  let names: string[] = [];
  try {
    names = fs.readdirSync(path.join(home, "profiles")).sort();
  } catch {}
  for (const n of names) {
    const dir = path.join(home, "profiles", n);
    if (own(home, dir, "dir") && isProfile(dir)) out.push(profile(home, n, dir));
  }
  return out;
}
