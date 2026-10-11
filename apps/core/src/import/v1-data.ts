// What APX v1 keeps on disk (~/.apx and each project's .apc/), read as v1 wrote it so the setup can bring it into v2.
// Read-only: nothing here writes to v1's folder. Secrets are read only to be stored in v2's own secret store.
import fs from "node:fs";
import path from "node:path";
import { ChannelRooms, type PersonRelation, RoomMode, type ServiceSettings } from "@apx/protocol";

/** A JSON file of v1's, parsed; throws like JSON.parse. Windows editors and PowerShell 5 may start it with a BOM. */
export const jsonFile = (file: string): unknown => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));

const readJson = (file: string): unknown => {
  try {
    return jsonFile(file);
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

/**
 * Project storages v1 still has but no longer lists (the folder was removed or unregistered), with the name their
 * memory file's title gives ("# Acme — project memory"), else their id. Only those with notes.
 */
export function v1OrphanStorages(home: string): Array<{ storage: string; name: string }> {
  const root = path.join(home, "projects");
  const known = new Set(v1Projects(home).map((p) => p.storage));
  let ids: string[];
  try {
    ids = fs.readdirSync(root).sort();
  } catch {
    return [];
  }
  return ids.flatMap((id) => {
    const storage = path.join(root, id);
    if (id === "default" || id.startsWith(".") || known.has(storage)) return [];
    let head: string;
    try {
      head = fs.readFileSync(path.join(storage, "memory.md"), "utf8").slice(0, 400);
    } catch {
      return [];
    }
    const title = /^#\s+(.+)$/m
      .exec(head)?.[1]
      ?.split(/\s+[—–-]\s+/)[0]
      ?.trim();
    return [{ storage, name: (title || id).slice(0, 60) }];
  });
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
  /** The v1 profile that installed it ("secretary"): v2's own profile brings that routine instead. */
  profile?: string;
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
        ...(str(o.origin)?.startsWith("profile:") ? { profile: String(o.origin).slice(8) } : {}),
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

export type V1Discord = {
  token: string;
  enabled: boolean;
  /** The owner's Discord user ids. */
  ownerIds: string[];
  rooms: ChannelRooms;
};

/** v1's Discord bot: the owner's ids and the server rooms it read or spoke in, with its words, knowledge and rules. */
export function v1Discord(home: string): V1Discord | undefined {
  const d = obj(v1Config(home).discord);
  const token = str(d.token);
  if (!token) return undefined;
  const ids = (v: unknown) =>
    list(v).flatMap((x) => (/^\d{15,21}$/.test(String(x ?? "").trim()) ? [String(x).trim()] : []));
  const limits = obj(d.limits);
  const secs = (v: unknown, def: number) => Math.round((num(v) ?? def * 1000) / 1000);
  const rooms = Object.entries(obj(d.channels)).flatMap(([id, row]) => {
    const r = obj(row);
    const mode = RoomMode.safeParse(String(r.mode ?? "").toLowerCase());
    return /^\d{15,21}$/.test(id) && mode.success
      ? [{ id, name: (str(r.name) ?? "").slice(0, 80), mode: mode.data }]
      : [];
  });
  return {
    token,
    enabled: d.enabled !== false,
    ownerIds: ids(d.owner_ids),
    rooms: ChannelRooms.parse({
      rooms: rooms.slice(0, 50),
      names: list(d.names)
        .flatMap((n) => (str(n) ? [String(n).trim().toLowerCase().slice(0, 40)] : []))
        .slice(0, 10),
      owner_only: d.owner_only === true,
      knowledge: (str(d.knowledge) ?? "").slice(0, 12_000),
      rules: (str(d.rules) ?? "").slice(0, 2000),
      reply_when: (str(d.reply_when) ?? "").slice(0, 2000),
      limits: {
        user_cooldown_s: Math.min(3600, secs(limits.user_cooldown_ms, 20)),
        room_replies_per_hour: Math.max(1, Math.min(600, num(limits.channel_replies_per_hour) ?? 30)),
        checks_per_hour: Math.min(1000, num(limits.gate_checks_per_hour) ?? 120),
      },
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

/** Variables in v1's flat name → value file: the global one (~/.apx/vars.json) or a project's (its storage's). */
function varsFile(file: string): Array<{ name: string; value: string }> {
  return Object.entries(obj(readJson(file))).flatMap(([name, v]) => {
    const value = typeof v === "string" ? v : str(obj(v).value);
    return value && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) ? [{ name, value }] : [];
  });
}

/** v1's global variables, for v2's secret store. */
export const v1Vars = (home: string) => varsFile(path.join(home, "vars.json"));

/** A v1 project's own variables (~/.apx/projects/<apx_id>/vars.json): v1 let them win over the global ones there. */
export const v1ProjectVars = (storage: string) => (storage ? varsFile(path.join(storage, "vars.json")) : []);

export type V1Embedder = { id: string; service: ServiceSettings; api_key?: string };

const EMBED_DEFAULTS = {
  ollama: { label: "Ollama", dialect: "ollama-embed", base_url: "http://127.0.0.1:11434", model: "nomic-embed-text" },
  gemini: {
    label: "Gemini",
    dialect: "gemini-embed",
    base_url: "https://generativelanguage.googleapis.com",
    model: "gemini-embedding-001",
  },
  openai: {
    label: "OpenAI",
    dialect: "openai-embed",
    base_url: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
  },
} as const;
type EmbedId = keyof typeof EMBED_DEFAULTS;
const isEmbedId = (x: unknown): x is EmbedId => x === "ollama" || x === "gemini" || x === "openai";

/** A model engine's key in v1's config (`engines.<id>`): its api_key, or the first of its api_keys. */
export function v1EngineKey(config: Record<string, unknown>, id: string): string | undefined {
  const e = obj(obj(config.engines)[id]);
  return str(e.api_key) ?? list(e.api_keys).map(str).find(Boolean);
}

/**
 * v1's embedding engines (memory.embeddings), in the order it tried them, and whether it picked skills by meaning.
 * As v1 did, Ollama falls back to the Ollama engine's address and a cloud engine to its model engine's key; one with
 * no key at all stays behind. One v1 had switched off comes in off.
 */
export function v1Embeddings(home: string): { engines: V1Embedder[]; picker?: boolean } {
  const config = v1Config(home);
  const mem = obj(config.memory);
  const e = obj(mem.embeddings);
  const picker = obj(obj(config.skills).inspector).enabled;
  const choice = typeof picker === "boolean" ? { picker } : {};
  if (!Object.keys(e).length && !str(mem.embed_model) && !str(mem.embed_base_url)) return { engines: [], ...choice };
  const single = e.mode === "single" || (e.mode !== "chain" && isEmbedId(e.provider));
  const order = single && isEmbedId(e.provider) ? [e.provider] : list(e.order).filter(isEmbedId);
  const engines = (order.length ? order : (["ollama", "gemini", "openai"] as const)).flatMap((id): V1Embedder[] => {
    const c = obj(e[id]);
    const d = EMBED_DEFAULTS[id];
    const key = id === "ollama" ? undefined : (str(c.api_key) ?? v1EngineKey(config, id));
    if (id !== "ollama" && !key) return [];
    const engine = obj(obj(config.engines)[id]);
    const base =
      id === "ollama"
        ? // v1 called Ollama's own API at the root; its chat engine's address may carry /v1.
          (str(c.base_url) ?? str(mem.embed_base_url) ?? str(engine.base_url) ?? d.base_url)
            .replace(/\/+$/, "")
            .replace(/\/v1$/, "")
        : id === "openai"
          ? (str(c.base_url) ?? str(engine.base_url) ?? d.base_url)
          : d.base_url;
    return [
      {
        id: `v1-${id}`,
        service: {
          kind: "embedding",
          dialect: d.dialect,
          label: d.label,
          base_url: base,
          enabled: c.enabled !== false,
          needs_key: id !== "ollama",
          model: str(c.model) ?? (id === "ollama" ? str(mem.embed_model) : undefined) ?? d.model,
        },
        ...(key ? { api_key: key } : {}),
      },
    ];
  });
  return { engines, ...choice };
}

export type V1Identity = {
  owner_name?: string;
  owner_about?: string;
  language?: string;
  timezone?: string;
  /** The super-agent: its name, face (a blob), personality and the owner's extra instructions (its prompt). */
  agent_name?: string;
  blob?: string;
  personality?: string;
  prompt?: string;
  /** v1's `permission_mode` (total | automatico | permiso) as v2's autonomy. */
  autonomy?: "total" | "standard" | "ask";
  /** The profile v1 ran, with its settings in v2's names. */
  profile?: { id: string; values: Record<string, string | number> };
  /** v1's nudge budget and quiet hours. */
  notices?: {
    budget_per_day?: number;
    quiet_from?: string;
    quiet_to?: string;
    project_gap_min?: number;
    kind_gap_min?: number;
  };
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Who the owner is and how their super-agent was set up in v1 (identity.json, config.json's user, super_agent, profile). */
export function v1Identity(home: string): V1Identity {
  const id = obj(readJson(path.join(home, "identity.json")));
  const config = v1Config(home);
  const user = obj(config.user);
  const sa = obj(config.super_agent);
  const personality = str(id.personality);
  const autonomy = ({ total: "total", automatico: "standard", permiso: "ask" } as const)[
    str(sa.permission_mode) as "total" | "automatico" | "permiso"
  ];
  const prompt = str(sa.system) ?? str(sa.instructions);
  const blob = str(sa.icon);
  const prof = obj(config.profile);
  const active = str(prof.active);
  const c = obj(prof.config ?? obj(prof.configs)[active ?? ""]);
  // v1 watched on a cron ("0 */2 * * *"); v2 counts hours.
  const every = /^\S+ \*\/(\d{1,2}) /.exec(str(c.watch_schedule) ?? "")?.[1];
  const values: Record<string, string | number> = {};
  const put = (key: string, v: string | number | undefined) => {
    if (v !== undefined) values[key] = v;
  };
  put("day_open", str(c.day_open_schedule));
  put("day_close", str(c.day_close_schedule));
  put("watch_every_h", every ? Number(every) : undefined);
  put("calendar_command", typeof c.calendar_command === "string" ? c.calendar_command : undefined);
  put("stale_project_days", num(c.stale_project_days));
  put("waiting_hours", num(c.blocked_task_hours));
  put("commitment_lead_hours", num(c.commitment_lead_hours));
  put("formality", str(c.formality));
  const quiet = /^(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(str(c.quiet_hours) ?? "");
  const notices = {
    ...(num(c.nudge_budget_per_day) !== undefined ? { budget_per_day: num(c.nudge_budget_per_day) } : {}),
    ...(quiet ? { quiet_from: quiet[1], quiet_to: quiet[2] } : {}),
    ...(num(c.nudge_project_cooldown_minutes) !== undefined
      ? { project_gap_min: num(c.nudge_project_cooldown_minutes) }
      : {}),
    ...(num(c.nudge_kind_cooldown_minutes) !== undefined ? { kind_gap_min: num(c.nudge_kind_cooldown_minutes) } : {}),
  };
  const lang = str(user.language);
  return {
    ...(str(id.owner_name) ? { owner_name: str(id.owner_name) } : {}),
    ...(str(id.owner_context) ? { owner_about: str(id.owner_context) } : {}),
    ...(lang && /^[a-z]{2}$/.test(lang) ? { language: lang } : {}),
    ...(str(user.timezone) ? { timezone: str(user.timezone) } : {}),
    ...(str(id.agent_name) ? { agent_name: str(id.agent_name) } : {}),
    ...(blob && /^[a-z]{2,20}$/.test(blob) ? { blob } : {}),
    ...(personality ? { personality } : {}),
    ...(autonomy ? { autonomy } : {}),
    ...(prompt ? { prompt } : {}),
    ...(active ? { profile: { id: active, values } } : {}),
    ...(Object.keys(notices).length ? { notices } : {}),
  };
}
