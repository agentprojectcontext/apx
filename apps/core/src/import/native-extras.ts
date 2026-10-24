// What a Claude Code or Codex project keeps besides its chats: its MCP servers, the memory notes the engine wrote,
// the tasks left open and Codex's automations. Read-only on the CLIs' folders; APX applies them through its own
// methods (sessions.import).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseFrontmatter } from "../apc/frontmatter.ts";
import { isInside } from "../paths.ts";
import { sessionText } from "./native-read.ts";
import type { NativeEngine, NativeHomes, NativeSession } from "./native-sessions.ts";

export type FoundServer = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};
/** `secrets`: the env or header keys holding a credential written in the file, which never go to a project's file. */
export type FoundMcp = { name: string; server: FoundServer; secrets: string[] };
export type FoundNote = { key: string; text: string };
export type FoundTask = { key: string; title: string; description: string; session: string };
export type FoundRoutine = { key: string; name: string; prompt: string; cron: string; active: boolean };
export type Extras = { mcps: FoundMcp[]; notes: FoundNote[]; tasks: FoundTask[]; routines: FoundRoutine[] };

const NOTE_CHARS = 2000;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => Object.fromEntries(Object.entries(obj(v)).map(([k, x]) => [k, String(x)]));
const within = (dir: string, root: string) => path.isAbsolute(dir) && isInside(root, dir);

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

const SECRET_KEY = /key|token|secret|pass|pwd|auth|credential|cookie/i;
/** Keys whose value is a credential (or a reference to one the owner's shell had): APX needs the owner to give it. */
function secretKeys(s: FoundServer): string[] {
  const env = Object.entries(s.env ?? {}).filter(([k, v]) => v && (SECRET_KEY.test(k) || v.includes("${")));
  const headers = Object.entries(s.headers ?? {}).filter(([k, v]) => v && (SECRET_KEY.test(k) || v.length >= 24));
  return [...env, ...headers].map(([k]) => k);
}

function server(v: unknown): FoundServer | undefined {
  const o = obj(v);
  const command = str(o.command);
  const url = str(o.url);
  if (!command === !url) return undefined;
  const args = Array.isArray(o.args) ? o.args.map(String) : undefined;
  const env = o.env ? strings(o.env) : undefined;
  const headers = o.headers ? strings(o.headers) : undefined;
  return {
    ...(command ? { command } : { url }),
    ...(args?.length ? { args } : {}),
    ...(env && Object.keys(env).length ? { env } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
  };
}

const mcpsOf = (servers: Record<string, unknown>): FoundMcp[] =>
  Object.entries(servers).flatMap(([name, v]) => {
    const s = server(v);
    return s ? [{ name, server: s, secrets: secretKeys(s) }] : [];
  });

/** A note from one of Claude Code's memory files: its summary line, then its body. */
function noteOf(text: string): string {
  const { fields, body } = parseFrontmatter(text);
  const summary = typeof fields.description === "string" ? fields.description.trim() : "";
  return [summary, body.trim()].filter(Boolean).join("\n\n").slice(0, NOTE_CHARS);
}

/** The tasks a Claude Code session made (TaskCreate, numbered in order) still open when it last changed them. */
function claudeTasks(s: NativeSession): FoundTask[] {
  const text = sessionText(s.file) ?? "";
  if (!text.includes('"TaskCreate"')) return [];
  const tasks: Array<FoundTask & { status: string }> = [];
  for (const line of text.split("\n")) {
    if (!line.includes('"TaskCreate"') && !line.includes('"TaskUpdate"')) continue;
    let content: unknown;
    try {
      content = obj(obj(JSON.parse(line)).message).content;
    } catch {
      continue;
    }
    for (const p of Array.isArray(content) ? content.map(obj) : []) {
      const input = obj(p.input);
      if (p.type !== "tool_use") continue;
      if (p.name === "TaskCreate" && str(input.subject))
        tasks.push({
          key: `${s.id}:${tasks.length + 1}`,
          title: str(input.subject).slice(0, 200),
          description: str(input.description),
          session: s.id,
          status: "pending",
        });
      const t = p.name === "TaskUpdate" ? tasks[Number(input.taskId) - 1] : undefined;
      if (t && str(input.status)) t.status = str(input.status);
    }
  }
  return tasks.filter((t) => t.status !== "completed" && t.status !== "deleted").map(({ status: _s, ...t }) => t);
}

function claudeExtras(homes: NativeHomes, cwd: string, sessions: NativeSession[]): Extras {
  const shared = obj(obj(readJson(path.join(cwd, ".mcp.json"))).mcpServers);
  // Claude Code keeps its own config next to its folder (~/.claude.json), or inside it with CLAUDE_CONFIG_DIR.
  const config = [path.join(homes.claude, ".claude.json"), path.join(path.dirname(homes.claude), ".claude.json")]
    .map(readJson)
    .find(Boolean);
  const local = obj(obj(obj(obj(config).projects)[cwd]).mcpServers);
  const memoryDirs = new Set(sessions.map((s) => path.join(path.dirname(s.file), "memory")));
  const notes = [...memoryDirs].flatMap((dir) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "MEMORY.md");
    } catch {
      return [];
    }
    return names.flatMap((n) => {
      const text = noteOf(fs.readFileSync(path.join(dir, n), "utf8"));
      return text ? [{ key: `memory:${path.join(dir, n)}`, text }] : [];
    });
  });
  return {
    mcps: mcpsOf({ ...shared, ...local }),
    notes,
    tasks: sessions.flatMap(claudeTasks),
    routines: [],
  };
}

/** The values of a flat TOML file (Codex's automation.toml): strings, string arrays, numbers and booleans. */
export function tomlValues(text: string): Record<string, string | string[] | number | boolean> {
  const out: Record<string, string | string[] | number | boolean> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m?.[1] || !m[2]) continue;
    const raw = m[2];
    try {
      if (raw.startsWith('"') || raw.startsWith("[")) out[m[1]] = JSON.parse(raw) as string | string[];
      else if (raw === "true" || raw === "false") out[m[1]] = raw === "true";
      else if (/^-?\d+$/.test(raw)) out[m[1]] = Number(raw);
    } catch {}
  }
  return out;
}

/** Codex's `[mcp_servers.<name>]` tables (and their `.env` / `.headers` sub-tables) from a config.toml. */
export function tomlServers(text: string): Record<string, unknown> {
  const servers: Record<string, Record<string, unknown>> = {};
  let at: { name: string; sub?: string | undefined } | undefined;
  const lines: string[] = [];
  const flush = () => {
    if (!at) return;
    const values = tomlValues(lines.join("\n"));
    const srv = servers[at.name] ?? {};
    servers[at.name] = at.sub ? { ...srv, [at.sub]: values } : { ...srv, ...values };
    lines.length = 0;
  };
  for (const line of text.split("\n")) {
    const head = /^\s*\[mcp_servers\.("?)([^".\]]+)\1(?:\.(env|headers|http_headers))?\]\s*$/.exec(line);
    if (head?.[2]) {
      flush();
      at = { name: head[2], sub: head[3] === "http_headers" ? "headers" : head[3] };
    } else if (/^\s*\[/.test(line)) {
      flush();
      at = undefined;
    } else if (at) lines.push(line);
  }
  flush();
  return servers;
}

const DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
/** An iCalendar RRULE as cron, for the shapes automations use; undefined for the rest. */
export function cronOf(rrule: string): string | undefined {
  const p = Object.fromEntries(rrule.split(";").map((kv) => kv.split("=") as [string, string]));
  const minute = p.BYMINUTE ?? "0";
  const hour = p.BYHOUR ?? "0";
  const nums = (v: string | undefined) => (v ?? "").split(",").every((x) => /^\d+$/.test(x));
  if (!nums(minute) || !nums(hour)) return undefined;
  const every = Number(p.INTERVAL ?? "1");
  switch (p.FREQ) {
    case "HOURLY":
      return `${minute} ${every > 1 ? `*/${every}` : "*"} * * *`;
    case "DAILY":
      return every === 1 ? `${minute} ${hour} * * *` : undefined;
    case "WEEKLY": {
      const days = (p.BYDAY ?? "MO").split(",").map((d) => DAYS[d]);
      return every === 1 && days.every((d) => d !== undefined) ? `${minute} ${hour} * * ${days.join(",")}` : undefined;
    }
    case "MONTHLY":
      return every === 1 && nums(p.BYMONTHDAY) && p.BYMONTHDAY ? `${minute} ${hour} ${p.BYMONTHDAY} * *` : undefined;
    default:
      return undefined;
  }
}

function codexRoutines(home: string, cwd: string): FoundRoutine[] {
  const dir = path.join(home, "automations");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    let v: ReturnType<typeof tomlValues>;
    try {
      v = tomlValues(fs.readFileSync(path.join(dir, n, "automation.toml"), "utf8"));
    } catch {
      return [];
    }
    const cwds = Array.isArray(v.cwds) ? v.cwds : [];
    const cron = typeof v.rrule === "string" ? cronOf(v.rrule) : undefined;
    if (!cron || typeof v.prompt !== "string" || !cwds.some((c) => within(c, cwd))) return [];
    return [
      {
        key: `automation:${str(v.id) || n}`,
        name: str(v.name) || n,
        prompt: v.prompt,
        cron,
        active: str(v.status).toUpperCase() === "ACTIVE",
      },
    ];
  });
}

/** Rows of a Codex database that may not be there (an older or newer Codex keeps others). */
function rows(file: string, sql: string, ids: string[]): Record<string, unknown>[] {
  if (!ids.length || !fs.existsSync(file)) return [];
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    return db.prepare(sql.replace("?", ids.map(() => "?").join(","))).all(...ids);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function codexExtras(homes: NativeHomes, cwd: string, sessions: NativeSession[]): Extras {
  const ids = sessions.map((s) => s.id);
  const notes = rows(
    path.join(homes.codex, "memories_1.sqlite"),
    "SELECT thread_id, raw_memory FROM stage1_outputs WHERE thread_id IN (?)",
    ids,
  ).flatMap((r) => {
    const text = str(r.raw_memory).trim().slice(0, NOTE_CHARS);
    return text ? [{ key: `codex-memory:${str(r.thread_id)}`, text }] : [];
  });
  const tasks = rows(
    path.join(homes.codex, "goals_1.sqlite"),
    "SELECT thread_id, goal_id, objective, status FROM thread_goals WHERE status != 'complete' AND thread_id IN (?)",
    ids,
  ).flatMap((r) => {
    const objective = str(r.objective).trim();
    return objective
      ? [
          {
            key: `codex-goal:${str(r.goal_id)}`,
            title: objective.split("\n")[0]?.slice(0, 200) ?? objective,
            description: objective,
            session: str(r.thread_id),
          },
        ]
      : [];
  });
  let config = "";
  try {
    config = fs.readFileSync(path.join(cwd, ".codex", "config.toml"), "utf8");
  } catch {}
  return { mcps: mcpsOf(tomlServers(config)), notes, tasks, routines: codexRoutines(homes.codex, cwd) };
}

/** What the project at `cwd` keeps in that engine besides its chats (`sessions`: its chats there). */
export function nativeExtras(homes: NativeHomes, engine: NativeEngine, cwd: string, sessions: NativeSession[]): Extras {
  return engine === "claude" ? claudeExtras(homes, cwd, sessions) : codexExtras(homes, cwd, sessions);
}
