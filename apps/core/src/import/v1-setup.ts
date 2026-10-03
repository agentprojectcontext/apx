// The setup's v1 import: what v1 has (counted per group) and bringing the chosen groups into v2. v1's folder is only
// read. Routines come in turned off (v1 may still run them) and a Telegram bot v2 already has is kept.
import fs from "node:fs";
import path from "node:path";
import type { RoutineAction, Schedule, TaskPriority } from "@apx/protocol";
import type { ApcSync } from "../apc/sync.ts";
import type { Channels } from "../channels/manager.ts";
import { OWNER_ID } from "../domain/persons.ts";
import type { Store } from "../domain/store.ts";
import { dueOf } from "../domain/tasks.ts";
import type { Secrets } from "../secrets.ts";
import { importKeys, importSkills, v1KeyCount } from "./v1.ts";
import {
  type V1Project,
  v1AgentCount,
  v1Notes,
  v1OpenCommitments,
  v1OpenTasks,
  v1Projects,
  v1Routines,
  v1SkillCount,
  v1Telegram,
  v1Vars,
  v1WhatsApp,
} from "./v1-data.ts";

export const V1_GROUPS = [
  "projects",
  "skills",
  "keys",
  "vars",
  "memory",
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

/** How much of each group v1 has, and a word on it (channel names). */
export function scanV1(home: string): Array<{ id: V1Group; count: number; detail?: string }> {
  const projects = v1Projects(home);
  const all = spaces(home);
  const tg = v1Telegram(home);
  const wa = v1WhatsApp(home);
  const memory =
    v1Notes(path.join(home, "memory.md")).length +
    projects.reduce((n, p) => n + v1Notes(path.join(p.storage, "memory.md")).length, 0);
  return [
    {
      id: "projects",
      count: projects.length,
      detail: String(projects.reduce((n, p) => n + v1AgentCount(p), 0)),
    },
    { id: "skills", count: v1SkillCount(home) },
    { id: "keys", count: v1KeyCount(home) },
    { id: "vars", count: v1Vars(home).length },
    { id: "memory", count: memory },
    {
      id: "channels",
      count: (tg ? 1 : 0) + (wa ? 1 : 0),
      ...(tg || wa ? { detail: String((tg?.contacts.length ?? 0) + (wa?.contacts.length ?? 0)) } : {}),
    },
    { id: "tasks", count: all.reduce((n, s) => n + v1OpenTasks(s.storage).length, 0) },
    { id: "commitments", count: all.reduce((n, s) => n + v1OpenCommitments(s.storage).length, 0) },
    { id: "routines", count: all.reduce((n, s) => n + v1Routines(s.storage).length, 0) },
  ];
}

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
    return n;
  });
  run("skills", () => importSkills(path.join(home, "skills"), path.join(deps.v2Home, "skills")).length);
  run("keys", () => importKeys(home, deps.secrets).length);
  run("vars", () => {
    let n = 0;
    for (const v of v1Vars(home))
      if (!deps.secrets.has(`secret://${v.name}`)) {
        deps.secrets.set(v.name, v.value);
        n++;
      }
    return n;
  });
  run("memory", () => {
    let n = 0;
    for (const text of v1Notes(path.join(home, "memory.md"))) {
      store.memories.add({ scope: "global", text, source: "owner" });
      n++;
    }
    for (const p of v1Projects(home)) {
      const project = projectOf(p);
      if (!project) continue;
      for (const text of v1Notes(path.join(p.storage, "memory.md"))) {
        store.memories.add({ scope: "project", project_id: project, text, source: "owner" });
        n++;
      }
    }
    return n;
  });
  run("channels", () => {
    if (!secretary) return 0;
    return importTelegram(deps, secretary.id) + importWhatsApp(deps, secretary.id);
  });
  const personFor = (name: string) => {
    const known = store.persons.list().find((p) => p.name.toLowerCase() === name.toLowerCase());
    return known ?? store.persons.create({ name: name.slice(0, 80), role: "contact" });
  };
  const addTask = (
    project: string | undefined,
    t: { title: string; description: string; due?: string; status: string; priority?: TaskPriority; tags: string[] },
    extra: { kind: "task" | "commitment" | "errand"; person_id?: string },
  ) => {
    if (!secretary) return;
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
  };
  run("tasks", () => {
    let n = 0;
    for (const s of spaces(home)) {
      const project = s.path ? projectOf(s) : undefined;
      if (s.path && !project) continue;
      for (const t of v1OpenTasks(s.storage)) {
        addTask(
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
        n++;
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
        addTask(
          project,
          { title: c.body, description: "", ...(c.due ? { due: c.due } : {}), status: "todo", tags: [] },
          { kind: "commitment", ...(person ? { person_id: person.id } : {}) },
        );
        n++;
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
        if (have.has(r.name)) continue;
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
