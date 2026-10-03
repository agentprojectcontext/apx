// What APX v1 keeps on disk (~/.apx and each project's .apc/), read as v1 wrote it so the setup can bring it into v2.
// Read-only: nothing here writes to v1's folder. Secrets are read only to be stored in v2's own secret store.
import fs from "node:fs";
import path from "node:path";
import type { PersonRelation } from "@apx/protocol";

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return undefined;
  }
};
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Every line of every `*.jsonl` in a folder that parses, in file order. */
function jsonl(dir: string): Record<string, unknown>[] {
  let files: string[];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
  } catch {
    return [];
  }
  const out: Record<string, unknown>[] = [];
  for (const f of files)
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(obj(JSON.parse(line)));
      } catch {}
    }
  return out;
}

export type V1Project = { path: string; name: string; storage: string };

/** v1's config.json (its settings and secrets): read only here. */
export const v1Config = (home: string) => obj(readJson(path.join(home, "config.json")));

/**
 * The projects v1 really has: each registered folder that is an APC project, with its storage under
 * ~/.apx/projects/<apx_id> (named by .apc/project.json, never derived from the path).
 */
export function v1Projects(home: string): V1Project[] {
  const out: V1Project[] = [];
  for (const p of list(v1Config(home).projects)) {
    const dir = str(obj(p).path);
    if (!dir || !fs.existsSync(path.join(dir, ".apc"))) continue;
    const meta = obj(readJson(path.join(dir, ".apc", "project.json")));
    const id = str(meta.apx_id);
    out.push({
      path: dir,
      name: str(meta.name) ?? path.basename(dir),
      storage: id ? path.join(home, "projects", id) : "",
    });
  }
  return out;
}

/** The agents a project defines (.apc/agents/*.md). */
export function v1AgentCount(project: V1Project): number {
  try {
    return fs.readdirSync(path.join(project.path, ".apc", "agents")).filter((f) => f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/** v1's own skills (~/.apx/skills/<name>/SKILL.md). */
export function v1SkillCount(home: string): number {
  try {
    return fs
      .readdirSync(path.join(home, "skills"))
      .filter((d) => fs.existsSync(path.join(home, "skills", d, "SKILL.md"))).length;
  } catch {
    return 0;
  }
}

export type V1Task = {
  title: string;
  description: string;
  due?: string;
  priority?: string;
  tags: string[];
  status?: string;
  errand: boolean;
};

/** The open tasks of a project, folded from v1's event log (create, update, done, drop, reopen). */
export function v1OpenTasks(storage: string): V1Task[] {
  const state = new Map<string, Record<string, unknown> & { _state: string }>();
  const events = jsonl(path.join(storage, "tasks"))
    .filter((e) => str(e.id) && str(e.op))
    .sort((a, b) => String(a.ts ?? "").localeCompare(String(b.ts ?? "")));
  for (const e of events) {
    const id = String(e.id);
    const cur = state.get(id);
    if (e.op === "create") {
      if (!cur) state.set(id, { ...e, _state: "open" });
    } else if (!cur) continue;
    else if (e.op === "update" && e.patch) Object.assign(cur, obj(e.patch));
    else if (e.op === "done") cur._state = "done";
    else if (e.op === "drop") cur._state = "dropped";
    else if (e.op === "reopen") cur._state = "open";
  }
  return [...state.values()]
    .filter((t) => t._state === "open" && str(t.title))
    .map((t) => ({
      title: String(t.title).slice(0, 200),
      description: (str(t.description) ?? str(t.body) ?? "").slice(0, 4000),
      ...(str(t.due) ? { due: String(t.due) } : {}),
      ...(str(t.priority) ? { priority: String(t.priority) } : {}),
      tags: list(t.tags).filter((x): x is string => typeof x === "string"),
      ...(str(t.status) ? { status: String(t.status) } : {}),
      errand: t.category === "trip",
    }));
}

export type V1Commitment = { counterparty: string; body: string; due?: string };

/** The open commitments of a project (the owner always owes them in v1). */
export function v1OpenCommitments(storage: string): V1Commitment[] {
  const state = new Map<string, Record<string, unknown> & { _state: string }>();
  for (const e of jsonl(path.join(storage, "commitments")).sort((a, b) =>
    String(a.ts ?? "").localeCompare(String(b.ts ?? "")),
  )) {
    const id = str(e.id);
    if (!id) continue;
    const cur = state.get(id);
    if (e.op === "create") {
      if (!cur) state.set(id, { ...e, _state: "open" });
    } else if (!cur) continue;
    else if (e.op === "update" && e.patch) Object.assign(cur, obj(e.patch));
    else if (e.op === "renegotiate") {
      cur._state = "open";
      if (str(e.due)) cur.due = e.due;
    } else if (e.op === "kept" || e.op === "missed" || e.op === "drop") cur._state = "closed";
  }
  return [...state.values()]
    .filter((c) => c._state === "open" && str(c.body))
    .map((c) => ({
      counterparty: str(c.counterparty) ?? "",
      body: String(c.body).slice(0, 200),
      ...(str(c.due) ? { due: String(c.due) } : {}),
    }));
}

export type V1Routine = {
  name: string;
  kind: string;
  schedule: string;
  prompt: string;
  agent?: string;
  command?: string;
  pre?: string;
  post?: string;
  /** v1's "anchor": its news always arrives (the day's open and close). */
  anchor?: boolean;
  enabled: boolean;
};

/** A project's routines (routines.json). */
export function v1Routines(storage: string): V1Routine[] {
  return list(obj(readJson(path.join(storage, "routines.json"))).routines).flatMap((r) => {
    const o = obj(r);
    const spec = obj(o.spec);
    const name = str(o.name);
    if (!name) return [];
    const join = (v: unknown) =>
      list(v)
        .map((c) => (typeof c === "string" ? c : str(obj(c).command ?? obj(c).cmd)))
        .filter(Boolean)
        .join(" && ");
    return [
      {
        name: name.slice(0, 120),
        kind: str(o.kind) ?? "exec_agent",
        schedule: str(o.schedule) ?? "manual",
        prompt: (str(spec.prompt) ?? str(spec.text) ?? str(spec.message) ?? "").slice(0, 20_000),
        ...(str(spec.agent) ? { agent: String(spec.agent) } : {}),
        ...(str(spec.command ?? spec.cmd) ? { command: String(spec.command ?? spec.cmd) } : {}),
        ...(join(o.pre_commands) ? { pre: join(o.pre_commands) } : {}),
        ...(join(o.post_commands) ? { post: join(o.post_commands) } : {}),
        ...(spec.anchor === true ? { anchor: true } : {}),
        enabled: o.enabled !== false,
      },
    ];
  });
}

/** The notes in a v1 memory file: one per bullet ("- [HH:MM][channel] text"), wrappers removed. */
export function v1Notes(file: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) =>
      l
        .replace(/^\s*[-*]\s+/, "")
        .replace(/^(\[[^\]]*\]\s*){1,2}/, "")
        .trim(),
    )
    .filter((t) => t.length > 2)
    .map((t) => t.slice(0, 2000));
}

export type V1Telegram = {
  token: string;
  ownerId?: string;
  contacts: Array<{ id: string; name: string }>;
};

/** v1's first Telegram bot, the owner's chat on it, and the contacts it knew. */
export function v1Telegram(home: string): V1Telegram | undefined {
  const tg = obj(v1Config(home).telegram);
  const ch = obj(list(tg.channels)[0]);
  const token = str(ch.bot_token);
  if (!token) return undefined;
  const owner = ch.owner_user_id ?? ch.chat_id;
  return {
    token,
    ...(owner != null && String(owner).trim() ? { ownerId: String(owner) } : {}),
    contacts: list(tg.contacts).flatMap((c) => {
      const o = obj(c);
      const id = o.user_id != null ? String(o.user_id) : "";
      const name = str(o.name) ?? str(o.username);
      return id && name && id !== String(owner) && o.role !== "owner" ? [{ id, name: name.slice(0, 80) }] : [];
    }),
  };
}

export type V1WhatsAppContact = {
  name: string;
  /** Every address v1 knew for them (their number and private ids), as WhatsApp ids. */
  addresses: string[];
  nickname?: string;
  relation?: PersonRelation;
  note?: string;
  rules?: string;
  /** v1 never answered them (a guest, or answers turned off for them). */
  muted: boolean;
  requests: boolean;
  notes: boolean;
};
export type V1WhatsApp = {
  /** The line is the owner's own phone. */
  selfOwner: boolean;
  /** Where the owner writes from (their phone's number and private ids). */
  owner: string[];
  contacts: V1WhatsAppContact[];
};

const RELATION: Record<string, PersonRelation> = {
  partner: "partner",
  family: "family",
  child: "family",
  friend: "friend",
  colleague: "coworker",
  business_partner: "associate",
  client: "client",
  supplier: "provider",
  acquaintance: "other",
  other: "other",
};

/** A WhatsApp id as v2 keys it: `user@domain`, without the device suffix; anything else is dropped. */
const waId = (v: unknown): string | undefined => {
  const s = str(v)?.toLowerCase();
  const m = s ? /^(\d+)(?::\d+)?@(s\.whatsapp\.net|lid)$/.exec(s) : null;
  return m ? `${m[1]}@${m[2]}` : undefined;
};

/** v1's WhatsApp: whether the line was the owner's phone, the owner's addresses and the roster with who each one is. */
export function v1WhatsApp(home: string): V1WhatsApp | undefined {
  const wa = obj(v1Config(home).whatsapp);
  if (!Object.keys(wa).length) return undefined;
  const selfOwner = wa.self_is_owner === true;
  const owner = [
    ...new Set(
      [wa.owner_jid, ...list(wa.owner_alts), ...(selfOwner ? [wa.self_jid] : [])].flatMap((a) => waId(a) ?? []),
    ),
  ];
  const contacts = list(wa.contacts).flatMap((c): V1WhatsAppContact[] => {
    const o = obj(c);
    const name = str(o.name) ?? str(o.nickname);
    const addresses = [...new Set([o.jid, ...list(o.alts)].flatMap((a) => waId(a) ?? []))].filter(
      (a) => !owner.includes(a),
    );
    if (!name || !addresses.length || o.role === "owner") return [];
    const caps = obj(o.capabilities);
    const facts = str(o.facts);
    const rules = [str(o.rules), facts ? `What you may tell them: ${facts}` : undefined].filter(Boolean).join("\n\n");
    const relation = RELATION[String(o.relationship ?? "")];
    const nickname = str(o.nickname);
    const note = str(o.bio);
    return [
      {
        name: name.slice(0, 80),
        addresses,
        ...(nickname ? { nickname: nickname.slice(0, 40) } : {}),
        ...(relation ? { relation } : {}),
        ...(note ? { note: note.slice(0, 500) } : {}),
        ...(rules ? { rules: rules.slice(0, 1000) } : {}),
        muted: o.role === "guest" || o.auto_reply === false,
        requests: caps.errands === true,
        notes: caps.facts === true,
      },
    ];
  });
  return { selfOwner, owner, contacts };
}

/** v1's variables (~/.apx/vars.json): names and values, for v2's secret store. */
export function v1Vars(home: string): Array<{ name: string; value: string }> {
  return Object.entries(obj(readJson(path.join(home, "vars.json")))).flatMap(([name, v]) => {
    const value = typeof v === "string" ? v : str(obj(v).value);
    return value && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) ? [{ name, value }] : [];
  });
}
