// Tasks. The owner sees and changes every one; an agent only those of its thread's project and the global ones, and
// what it creates goes to its thread's project. A comment that @mentions an agent runs a turn of it in the task's
// conversation.
import type { Author, Task, TaskColumn } from "@apx/protocol";
import { publicRun, type RunRecord } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { DEFAULT_COLUMNS } from "../domain/tasks.ts";
import { previewOf } from "../domain/threads.ts";
import type { Engine } from "../engine/engine.ts";
import { MAX_MENTION_DEPTH, mentioned } from "../engine/office.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

export function columnsOf(store: Store): TaskColumn[] {
  try {
    const saved = JSON.parse(store.settings.get("task_columns") ?? "null") as TaskColumn[] | null;
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_COLUMNS;
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** A due date as a moment: a bare day ("2026-10-05") means 09:00 that day, local time. */
export function dueOf(text: string | null | undefined): string | null {
  if (!text) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 9) : new Date(text);
  if (Number.isNaN(d.getTime())) throw badRequest(`"${text}" is not a date`);
  return d.toISOString();
}

export function taskHandlers(store: Store, engine: Engine) {
  /** The agent's project (from its thread), or undefined for the owner. */
  const agentScope = (ctx: CallContext) =>
    ctx.agent ? { project: store.threads.get(ctx.agent.thread_id)?.project_id } : undefined;
  const by = (ctx: CallContext) => ctx.agent?.id ?? "owner";

  /** A task the caller may see and change. */
  function visible(id: string, ctx: CallContext): Task {
    const t = store.tasks.get(id);
    if (!t) throw notFound(`task ${id}`);
    const scope = agentScope(ctx);
    if (scope && t.project_id && t.project_id !== scope.project)
      throw unauthorized("an agent works only on its own project's tasks");
    return t;
  }

  const checkStatus = (status: string | undefined) => {
    if (status && !columnsOf(store).some((c) => c.id === status))
      throw badRequest(
        `no column "${status}" (columns: ${columnsOf(store)
          .map((c) => c.id)
          .join(", ")})`,
      );
  };
  const checkAgent = (id: string | null | undefined) => {
    if (id && !store.agents.get(id)) throw notFound(`agent ${id}`);
  };
  /** A person by id or exact name (any case); the owner is never a commitment's counterpart. */
  const personOf = (ref: string): string => {
    const key = ref.trim().toLowerCase();
    const p = store.persons.get(ref) ?? store.persons.list().find((x) => x.name.toLowerCase() === key);
    if (!p) throw notFound(`person ${ref} (add them to your contacts first)`);
    if (p.role === "owner") throw badRequest("a commitment is with someone else, not with the owner");
    return p.id;
  };

  return {
    "tasks.list": ({ project, state, assignee, commitments, person, limit }, ctx) => {
      const scope = agentScope(ctx);
      const projects = scope ? [scope.project, undefined] : project ? [project] : undefined;
      return {
        tasks: store.tasks.list({ projects, state: state ?? "open", assignee, commitments, person, limit }),
        columns: columnsOf(store),
      };
    },
    "tasks.get": ({ task }, ctx) => {
      const t = visible(task, ctx);
      return { task: t, events: store.tasks.events(t.id) };
    },
    "tasks.create": (p, ctx) => {
      checkStatus(p.status);
      checkAgent(p.assignee);
      const scope = agentScope(ctx);
      const project = scope ? scope.project : p.project;
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      if (p.parent) visible(p.parent, ctx);
      const person = p.person ? personOf(p.person) : undefined;
      const due = dueOf(p.due_at);
      // The task's conversation: the assignee answers there, or the super-agent until someone is assigned.
      const home = store.threads.get(HOME_THREAD_ID);
      const agent = p.assignee ?? home?.agent_ids[0] ?? "roby";
      return store.tx(() => {
        const thread = store.threads.create({ kind: "task", title: p.title, agent_ids: [agent], project_id: project });
        return store.tasks.create({
          title: p.title,
          description: p.description,
          project_id: project,
          assignee: p.assignee,
          status: p.status ?? columnsOf(store)[0]?.id ?? "todo",
          parent_id: p.parent,
          due_at: due ?? undefined,
          person_id: person,
          owed_by: p.owed_by,
          thread_id: thread.id,
          by: by(ctx),
        });
      });
    },
    "tasks.update": ({ task, person, due_at, ...c }, ctx) => {
      visible(task, ctx);
      checkStatus(c.status);
      checkAgent(c.assignee);
      return store.tasks.change(
        task,
        {
          ...c,
          ...(person !== undefined ? { person_id: person === null ? null : personOf(person) } : {}),
          ...(due_at !== undefined ? { due_at: dueOf(due_at) } : {}),
        },
        by(ctx),
      ) as Task;
    },
    "tasks.close": ({ task, state, note }, ctx) => {
      visible(task, ctx);
      return store.tasks.change(
        task,
        { state, ...(state !== "open" ? { awaits_owner: false } : {}) },
        by(ctx),
        note,
      ) as Task;
    },
    "tasks.comment": ({ task, text }, ctx) => {
      const t = visible(task, ctx);
      const owner = !ctx.agent;
      const author: Author = owner ? { kind: "user" } : { kind: "agent", id: ctx.agent?.id ?? "" };
      const authorName = ctx.agent ? (store.agents.get(ctx.agent.id)?.name ?? ctx.agent.id) : "owner";
      return store.tx(() => {
        const message = store.messages.add({ thread_id: t.thread_id, author, parts: [{ type: "text", text }] });
        store.threads.patch(t.thread_id, { preview: previewOf(text) });
        store.tasks.touched(t.id, by(ctx));
        // An agent's comment arrives as another agent's words (untrusted); the owner's as the owner's. Turns started by
        // an agent's mention count as hops, a few at most.
        const depth = ctx.agent ? (store.runs.get(ctx.agent.run_id)?.depth ?? 0) + 1 : 0;
        if (depth > MAX_MENTION_DEPTH) return { message, runs: [] };
        const runs: RunRecord[] = mentioned(store, text, t.project_id, ctx.agent?.id).map((a) =>
          engine.admit({
            thread_id: t.thread_id,
            agent_id: a.id,
            trigger: owner ? "user" : "a2a",
            origin: owner
              ? { kind: "user" }
              : {
                  kind: "agent",
                  id: ctx.agent?.id ?? "",
                  name: authorName,
                  thread_id: ctx.agent?.thread_id ?? "",
                  run_id: ctx.agent?.run_id ?? "",
                },
            text,
            depth,
          }),
        );
        return { message, runs: runs.map(publicRun) };
      });
    },
  } satisfies Partial<Handlers>;
}
