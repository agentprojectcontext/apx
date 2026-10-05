// The setup's v1 import: what v1 has (counted per group) and bringing the chosen groups into v2. v1's folder is only
// read. Routines come in turned off (v1 may still run them) and a Telegram bot v2 already has is kept.
import fs from "node:fs";
import path from "node:path";
import type { RoutineAction, Schedule, TaskPriority } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import type { Channels } from "../channels/manager.ts";
import { memorySettings, saveMemorySettings } from "../domain/memory-settings.ts";
import { saveOwnerIdentity } from "../domain/owner.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import { dueOf } from "../domain/tasks.ts";
import type { ProviderRegistry } from "../providers/registry.ts";
import { projectSecretName, type Secrets } from "../secrets.ts";
import type { Services } from "../services/registry.ts";
import { importSkills } from "./v1.ts";
import { importV1Chats, v1AgentNotes, v1ChatCount, v1DefaultAgents } from "./v1-chats.ts";
import {
  type V1Project,
  v1AgentCount,
  v1Discord,
  v1Embeddings,
  v1Identity,
  v1Notes,
  v1OpenCommitments,
  v1OpenTasks,
  v1OrphanStorages,
  v1Projects,
  v1ProjectVars,
  v1Routines,
  v1SkillCount,
  v1Telegram,
  v1Vars,
  v1WhatsApp,
} from "./v1-data.ts";
import { importV1Engines, v1EngineCount } from "./v1-engines.ts";
import { importV1Media, v1MediaCount } from "./v1-services.ts";

export const V1_GROUPS = [
  "projects",
  "skills",
  "keys",
  "vars",
  "memory",
  "embeddings",
  "services",
  "identity",
  "chats",
  "channels",
  "tasks",
  "commitments",
  "routines",
] as const;
export type V1Group = (typeof V1_GROUPS)[number];

export type V1ImportDeps = {
  store: Store;
  apc: ApcSync;
  secrets: Secrets;
  channels: Pick<Channels, "set" | "info">;
  services: Pick<Services, "set" | "has" | "order">;
  providers: Pick<ProviderRegistry, "all" | "set">;
  /** Runs a profile on the super-agent (its routines seeded); false when APX has no profile of that id. */
  runProfile: (id: string, values: Record<string, string | number>) => boolean;
  /** Indexes notes by meaning in the background (what is missing); its failure is only logged. */
  reindex?: () => void;
  v1Home: string;
  v2Home: string;
};

/** v1's default project: its storage is ~/.apx/projects/default and it maps to v2's Default (no project). */
const defaultSpace = (home: string): V1Project => ({
  path: "",
  name: "Default",
  storage: path.join(home, "projects", "default"),
});
const spaces = (home: string) => [defaultSpace(home), ...v1Projects(home)];

/**
 * Every v1 note file that becomes global: the super-agent's own, Default's (v1's workspace without a folder) and,
 * marked with their name, those of projects v1 no longer lists (v2 has no project for them).
 */
function globalNotes(home: string): Array<{ file: string; mark?: string }> {
  return [
    { file: path.join(home, "memory.md") },
    { file: path.join(defaultSpace(home).storage, "memory.md") },
    ...v1OrphanStorages(home).map((o) => ({ file: path.join(o.storage, "memory.md"), mark: `[v1 · ${o.name}] ` })),
  ];
}

/** How much of each group v1 has, and a word on it (channel names). */
export function scanV1(home: string): Array<{ id: V1Group; count: number; detail?: string }> {
  const projects = v1Projects(home);
  const all = spaces(home);
  const tg = v1Telegram(home);
  const wa = v1WhatsApp(home);
  const dc = v1Discord(home);
  const embedders = v1Embeddings(home).engines;
  const who = v1Identity(home);
  const talk = v1ChatCount(home);
  const identity = [who.owner_name, who.owner_about, who.timezone, who.personality || who.prompt, who.profile].filter(
    Boolean,
  ).length;
  const memory =
    globalNotes(home).reduce((n, g) => n + v1Notes(g.file).length, 0) +
    projects.reduce((n, p) => n + v1Notes(path.join(p.storage, "memory.md")).length, 0);
  return [
    {
      id: "projects",
      count: projects.length,
      detail: String(projects.reduce((n, p) => n + v1AgentCount(p), 0) + v1DefaultAgents(home).length),
    },
    { id: "skills", count: v1SkillCount(home) },
    { id: "keys", count: v1EngineCount(home) },
    {
      id: "vars",
      count: v1Vars(home).length + all.reduce((n, s) => n + v1ProjectVars(s.storage).length, 0),
    },
    { id: "memory", count: memory },
    {
      id: "identity",
      count: identity,
      ...(identity ? { detail: [who.owner_name, who.profile?.id].filter(Boolean).join(" · ") } : {}),
    },
    { id: "chats", count: talk.chats, ...(talk.chats ? { detail: String(talk.messages) } : {}) },
    {
      id: "embeddings",
      count: embedders.length,
      ...(embedders.length
        ? { detail: embedders.map((e) => `${e.service.label} · ${e.service.model ?? ""}`).join(", ") }
        : {}),
    },
    { id: "services", count: v1MediaCount(home) },
    {
      id: "channels",
      count: (tg ? 1 : 0) + (wa ? 1 : 0) + (dc ? 1 : 0),
      ...(tg || wa ? { detail: String((tg?.contacts.length ?? 0) + (wa?.contacts.length ?? 0)) } : {}),
    },
    { id: "tasks", count: all.reduce((n, s) => n + v1OpenTasks(s.storage).length, 0) },
    { id: "commitments", count: all.reduce((n, s) => n + v1OpenCommitments(s.storage).length, 0) },
    { id: "routines", count: all.reduce((n, s) => n + v1Routines(s.storage).filter((r) => !r.profile).length, 0) },
  ];
}

/** Ollama's address on this machine, where an embedding engine with no address of its own was put. */
const LOCAL_OLLAMA = "http://127.0.0.1:11434";

const PRIORITY: Record<string, TaskPriority> = { low: "low", normal: "normal", high: "high", urgent: "urgent" };
const STATUS: Record<string, string> = { pending: "todo", running: "doing", in_review: "review", blocked: "todo" };
const ACTION: Record<string, RoutineAction> = {
  exec_agent: "agent",
  super_agent: "agent",
  telegram: "message",
  heartbeat: "message",
  shell: "shell",
  watch: "watch",
};

/** v1's schedule text ("manual", "every:30m", "once:<iso>", a cron) as v2's. */
export function v1Schedule(text: string): Schedule {
  const s = text.trim().replace(/^cron\s+/, "");
  if (!s || s === "manual") return { kind: "manual" };
  const every = /^every:(\d+)(s|m|h|d)$/.exec(s);
  if (every) {
    const n = Number(every[1]);
    const unit = every[2] as "s" | "m" | "h" | "d";
    const minutes = unit === "s" ? Math.ceil(n / 60) : unit === "m" ? n : unit === "h" ? n * 60 : n * 1440;
    return { kind: "every", minutes: Math.min(Math.max(minutes, 5), 60 * 24 * 31) };
  }
  if (s.startsWith("once:")) return { kind: "once", at: s.slice(5) };
  return s.split(/\s+/).length === 5 ? { kind: "cron", cron: s } : { kind: "manual" };
}

/** Brings the chosen groups in; how many of each came, and what could not. */
export function importV1(deps: V1ImportDeps, groups: readonly V1Group[]) {
  const { store, v1Home: home } = deps;
  const done: Partial<Record<V1Group, number>> = {};
  const errors: string[] = [];
  const secretary = store.agents.list().find((a) => a.kind === "secretary");
  /** v2's project for a v1 space: Default has none; a folder is registered first (or found). */
  const projectOf = (s: V1Project): string | undefined => (s.path ? store.projects.byPath(s.path)?.id : undefined);
  const run = (group: V1Group, work: () => number) => {
    if (!groups.includes(group)) return;
    try {
      done[group] = work();
    } catch (err) {
      errors.push(`${group}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Projects first: tasks, notes and routines land in them.
  run("projects", () => {
    let n = 0;
    for (const p of v1Projects(home))
      try {
        deps.apc.register(p.path);
        n++;
      } catch {}
    importDefaultAgents(store, home);
    importAgentNotes(store, home);
    return n;
  });
  run("skills", () => importSkills(path.join(home, "skills"), path.join(deps.v2Home, "skills")).length);
  // v1's engines with their keys, and its main model with its fallback chain (see v1-engines.ts).
  run("keys", () => importV1Engines(deps, home));
  // A project's own values land in that project's scope (its MCP servers read them first); Default's are global.
  // A name v2 already keeps, in that scope, is the owner's current value.
  run("vars", () => {
    let n = 0;
    const put = (key: string, value: string) => {
      if (deps.secrets.listed(key)) return;
      deps.secrets.set(key, value);
      n++;
    };
    for (const v of v1Vars(home)) put(v.name, v.value);
    for (const s of spaces(home)) {
      const project = s.path ? projectOf(s) : undefined;
      if (s.path && !project) continue;
      for (const v of v1ProjectVars(s.storage)) put(project ? projectSecretName(project, v.name) : v.name, v.value);
    }
    return n;
  });
  // Counted by what is new: a note v2 already has (same scope and text) is not added twice.
  run("memory", () => {
    const before = store.memories.counts(undefined).total;
    for (const { file, mark } of globalNotes(home))
      for (const text of v1Notes(file))
        store.memories.add({ scope: "global", text: `${mark ?? ""}${text}`.slice(0, 2000), source: "owner" });
    for (const p of v1Projects(home)) {
      const project = projectOf(p);
      if (!project) continue;
      for (const text of v1Notes(path.join(p.storage, "memory.md")))
        store.memories.add({ scope: "project", project_id: project, text, source: "owner" });
    }
    return store.memories.counts(undefined).total - before;
  });
  // The engines v1 searched notes and picked skills with, in its order; one v2 already has (same id) is kept.
  run("embeddings", () => {
    const { engines, picker } = v1Embeddings(home);
    let n = 0;
    for (const e of engines) {
      const prev = store.settings.read("services").find((s) => s.id === e.id);
      // An Ollama left at this machine's address while v1 used another one (its engine's) could never answer.
      if (prev?.dialect === "ollama-embed" && prev.base_url === LOCAL_OLLAMA && e.service.base_url !== LOCAL_OLLAMA) {
        const { id: _id, ...rest } = prev;
        deps.services.set(e.id, { ...rest, base_url: e.service.base_url });
        n++;
      }
      if (prev) continue;
      deps.services.set(e.id, e.service, e.api_key);
      n++;
    }
    if (picker !== undefined) saveMemorySettings(store, { ...memorySettings(store), skill_picker: picker });
    return n;
  });
  // Images, voices (the active one first), transcription, the image defaults and spoken replies.
  run("services", () => importV1Media(deps, home));
  // Who the owner is, the super-agent's personality, and the profile it ran with its budget and quiet hours.
  run("identity", () => {
    const who = v1Identity(home);
    saveOwnerIdentity(store, {
      ...(who.owner_name ? { name: who.owner_name } : {}),
      ...(who.owner_about ? { about: who.owner_about } : {}),
      ...(who.language ? { language: who.language } : {}),
      ...(who.timezone ? { timezone: who.timezone } : {}),
    });
    let n = [who.owner_name, who.owner_about, who.timezone].filter(Boolean).length;
    // The super-agent as v1 had it: its name, face, personality and the owner's extra instructions.
    if (secretary && (who.agent_name || who.blob || who.personality || who.prompt)) {
      const { harness: _h, ...rest } = secretary;
      store.agents.upsert({
        ...rest,
        ...(who.agent_name ? { name: who.agent_name } : {}),
        ...(who.blob ? { blob: who.blob } : {}),
        ...(who.personality ? { personality: who.personality } : {}),
        ...(who.prompt && !secretary.prompt.trim() ? { prompt: who.prompt } : {}),
      });
      n++;
    }
    if (who.notices) {
      store.settings.write("notices", { ...store.settings.read("notices"), ...who.notices });
      n++;
    }
    if (who.profile && deps.runProfile(who.profile.id, who.profile.values)) n++;
    return n;
  });
  run("chats", () => {
    if (!secretary) return 0;
    return importV1Chats(store, home, {
      secretaryId: secretary.id,
      agentFor: (project, slug) => agentFor(store, project, slug),
    });
  });
  run("channels", () => {
    if (!secretary) return 0;
    return importTelegram(deps, secretary.id) + importWhatsApp(deps, secretary.id) + importDiscord(deps, secretary.id);
  });
  const personFor = (name: string) => {
    const known = store.persons.list().find((p) => p.name.toLowerCase() === name.toLowerCase());
    return known ?? store.persons.create({ name: name.slice(0, 80), role: "contact" });
  };
  const addTask = (
    project: string | undefined,
    t: { title: string; description: string; due?: string; status: string; priority?: TaskPriority; tags: string[] },
    extra: { kind: "task" | "commitment" | "errand"; person_id?: string },
  ): boolean => {
    // One already there (any state, the owner's or an earlier import's) is kept: importing again adds nothing.
    if (!secretary || store.tasks.has({ kind: extra.kind, project_id: project, title: t.title })) return false;
    let due: string | null = null;
    try {
      due = t.due ? dueOf(t.due) : null;
    } catch {}
    store.tx(() => {
      const thread = store.threads.create({
        kind: "task",
        title: t.title,
        agent_ids: [secretary.id],
        project_id: project,
      });
      store.tasks.create({
        title: t.title,
        description: t.description,
        project_id: project,
        status: t.status,
        due_at: due ?? undefined,
        // What was already due in v1 is not news: no reminder for it the moment it arrives.
        ...(due && Date.parse(due) <= Date.now() ? { reminded_at: new Date().toISOString() } : {}),
        kind: extra.kind,
        priority: t.priority,
        tags: t.tags,
        ...(extra.person_id ? { person_id: extra.person_id, owed_by: "owner" as const } : {}),
        thread_id: thread.id,
        by: "owner",
      });
    });
    return true;
  };
  run("tasks", () => {
    let n = 0;
    for (const s of spaces(home)) {
      const project = s.path ? projectOf(s) : undefined;
      if (s.path && !project) continue;
      for (const t of v1OpenTasks(s.storage)) {
        const added = addTask(
          project,
          {
            title: t.title,
            description: t.description,
            ...(t.due ? { due: t.due } : {}),
            status: STATUS[t.status ?? ""] ?? "todo",
            ...(t.priority && PRIORITY[t.priority] ? { priority: PRIORITY[t.priority] } : {}),
            tags: t.tags,
          },
          { kind: t.errand ? "errand" : "task" },
        );
        if (added) n++;
      }
    }
    return n;
  });
  run("commitments", () => {
    let n = 0;
    for (const s of spaces(home)) {
      const project = s.path ? projectOf(s) : undefined;
      if (s.path && !project) continue;
      for (const c of v1OpenCommitments(s.storage)) {
        const person = c.counterparty ? personFor(c.counterparty) : undefined;
        const added = addTask(
          project,
          { title: c.body, description: "", ...(c.due ? { due: c.due } : {}), status: "todo", tags: [] },
          { kind: "commitment", ...(person ? { person_id: person.id } : {}) },
        );
        if (added) n++;
      }
    }
    return n;
  });
  run("routines", () => {
    let n = 0;
    for (const s of spaces(home)) {
      const project = s.path ? projectOf(s) : undefined;
      if (s.path && !project) continue;
      const have = new Set(store.routines.list(project ?? null).map((r) => r.name));
      for (const r of v1Routines(s.storage)) {
        // A profile's routines come from v2's own profile (with v2's tools in their prompts), not as v1 wrote them.
        if (have.has(r.name) || r.profile) continue;
        const action = ACTION[r.kind] ?? "agent";
        const agent =
          (r.agent && store.agents.list().find((a) => a.project_id === project && a.slug === r.agent)) || secretary;
        const pre = action === "shell" ? (r.command ?? r.pre) : r.pre;
        if (!agent || (action === "shell" && !pre)) continue;
        store.routines.create({
          name: r.name,
          agent_id: agent.id,
          project_id: project,
          schedule: v1Schedule(r.schedule),
          action,
          prompt: r.prompt || r.name,
          pre_command: pre,
          post_command: r.post,
          call_model: "always",
          anchor: r.anchor ?? false,
          // v1 may still be running them: they wait, off, until the owner turns them on.
          enabled: false,
          next_run_at: undefined,
        });
        n++;
      }
    }
    return n;
  });
  // Notes that came in (or an engine to index them with) get their vectors now, without holding the setup.
  if (groups.includes("memory") || groups.includes("embeddings")) deps.reindex?.();
  return { imported: done, errors };
}

/** Whether v1's folder is there at all (a config.json). */
export const hasV1 = (home: string) => fs.existsSync(path.join(home, "config.json"));

/** v1's Telegram bot, the owner's chat on it and its contacts; a bot v2 already runs is the owner's current one. */
function importTelegram(deps: V1ImportDeps, agentId: string): number {
  const { store } = deps;
  const tg = v1Telegram(deps.v1Home);
  if (!tg) return 0;
  store.tx(() => {
    if (tg.ownerId) store.persons.link(OWNER_ID, { channel: "telegram", external_id: tg.ownerId, label: "Telegram" });
    for (const c of tg.contacts)
      if (!store.persons.byAddress("telegram", c.id)) {
        const p = store.persons.create({ name: c.name, role: "contact" });
        store.persons.link(p.id, { channel: "telegram", external_id: c.id, label: c.name });
      }
  });
  if (!deps.channels.info().some((c) => c.id === "telegram" && c.token_set))
    void deps.channels.set(
      "telegram",
      {
        type: "telegram",
        label: "Telegram",
        agent_id: agentId,
        enabled: true,
        strangers: "pair",
        concurrency: "queue",
        owner_thread: "home",
      },
      tg.token,
    );
  return 1 + tg.contacts.length;
}

/** v1's Discord bot: the owner's ids, and the server rooms with their modes, words, knowledge and rules. */
function importDiscord(deps: V1ImportDeps, agentId: string): number {
  const { store } = deps;
  const dc = v1Discord(deps.v1Home);
  if (!dc) return 0;
  store.tx(() => {
    store.persons.owner();
    for (const id of dc.ownerIds)
      store.persons.link(OWNER_ID, { channel: "discord", external_id: id, label: "Discord" });
  });
  if (!deps.channels.info().some((c) => c.id === "discord" && c.token_set))
    void deps.channels.set(
      "discord",
      {
        type: "discord",
        label: "Discord",
        agent_id: agentId,
        enabled: dc.enabled,
        // v1 answered strangers only in its rooms; a direct message from one waits for the owner.
        strangers: "ask",
        concurrency: "queue",
        owner_thread: "home",
        rooms: dc.rooms,
      },
      dc.token,
    );
  return 1 + dc.rooms.rooms.length;
}

/**
 * v1's WhatsApp: whose phone the line is, where the owner writes from, and every contact with who they are and what
 * their chat may do. The device itself is linked again with a QR: v1's credentials stay v1's (one device used by
 * two apps at once is cut off by WhatsApp).
 */
function importWhatsApp(deps: V1ImportDeps, agentId: string): number {
  const { store } = deps;
  const wa = v1WhatsApp(deps.v1Home);
  if (!wa) return 0;
  const label = "WhatsApp";
  store.tx(() => {
    store.persons.owner();
    for (const a of wa.owner) store.persons.link(OWNER_ID, { channel: "whatsapp", external_id: a, label });
    for (const c of wa.contacts) {
      if (c.addresses.some((a) => store.persons.byAddress("whatsapp", a))) continue;
      const p = store.persons.create({ name: c.name, role: "contact" });
      store.persons.update(p.id, {
        ...(c.nickname ? { nickname: c.nickname } : {}),
        ...(c.relation ? { relation: c.relation } : {}),
        ...(c.note ? { note: c.note } : {}),
        ...(c.rules ? { rules: c.rules } : {}),
        muted: c.muted,
        perms: { requests: c.requests, notes: c.notes },
      });
      for (const a of c.addresses) store.persons.link(p.id, { channel: "whatsapp", external_id: a, label: c.name });
    }
  });
  // v1 never answered a stranger: the owner hears who wrote and decides.
  if (!deps.channels.info().some((c) => c.id === "whatsapp"))
    void deps.channels.set("whatsapp", {
      type: "whatsapp",
      label,
      agent_id: agentId,
      enabled: true,
      strangers: "ask",
      concurrency: "queue",
      owner_thread: "home",
      self_owner: wa.selfOwner,
    });
  return 1 + wa.contacts.length;
}

/** A v1 agent in v2: Default's are global (by slug), a project's by its project and slug. */
function agentFor(store: Store, apxId: string | undefined, slug: string) {
  const projectId = apxId ? `p_${apxId}` : undefined;
  return store.agents
    .list()
    .find((a) => a.project_id === projectId && a.kind === "agent" && (a.slug === slug || a.id === slug));
}

/** Default's agents (v1 kept them in its own .apc folder) become global agents, each with its prompt and face. */
function importDefaultAgents(store: Store, home: string): number {
  let n = 0;
  for (const a of v1DefaultAgents(home)) {
    if (agentFor(store, undefined, a.slug)) continue;
    const prompt = [a.description && !a.prompt.includes(a.description) ? a.description : "", a.prompt]
      .filter(Boolean)
      .join("\n\n");
    const text = (k: string) => {
      const v = a.fields[k];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    const area = text("area");
    const personality = text("personality");
    store.agents.upsert({
      id: store.agents.get(a.slug) ? `v1-${a.slug}` : a.slug,
      name: a.name,
      role: a.role,
      kind: "agent",
      ...(a.icon && /^[a-z]{2,20}$/.test(a.icon) ? { blob: a.icon } : {}),
      browser_profile: "shared",
      slug: a.slug,
      ...(a.description ? { description: a.description } : {}),
      ...(area ? { area } : {}),
      ...(personality ? { personality } : {}),
      ...(a.skills.length ? { skills: a.skills } : {}),
      prompt,
    });
    n++;
  }
  return n;
}

/** What each agent noted for itself in v1, as that agent's own notes. */
function importAgentNotes(store: Store, home: string): number {
  let n = 0;
  for (const { project, slug, file } of v1AgentNotes(home)) {
    const agent = agentFor(store, project === "default" ? undefined : project, slug);
    if (!agent) continue;
    const have = new Set(store.memories.list({ agent_id: agent.id, limit: 500 }).map((m) => m.text));
    for (const text of v1Notes(file))
      if (!have.has(text)) {
        store.memories.add({ scope: "agent", agent_id: agent.id, text, source: "owner" });
        n++;
      }
  }
  return n;
}
