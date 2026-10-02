// Tasks. The owner sees and changes every one; an agent only those of its thread's project and the global ones, and
// what it creates goes to its thread's project. A comment that @mentions an agent runs a turn of it in the task's
// conversation.
import type { Author, Task } from "@apx/protocol";
import { publicRun, type RunRecord } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { columnsOf, dueOf, tagsOf } from "../domain/tasks.ts";
import { previewOf } from "../domain/threads.ts";
import type { Engine } from "../engine/engine.ts";
import { MAX_MENTION_DEPTH, mentioned } from "../engine/office.ts";
import { badRequest, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";

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
  /** An assignee must exist and belong to the task's project (or to none). */
  const checkAgent = (id: string | null | undefined, project: string | undefined) => {
    if (!id) return;
    const a = store.agents.get(id);
    if (!a) throw notFound(`agent ${id}`);
    if (a.project_id && a.project_id !== project) throw badRequest(`${a.name} works in another project`);
  };
  /** A person by id or exact name (any case); never the owner or a blocked person, never a guess between two. */
  const personOf = (ref: string): string => {
    const key = ref.trim().toLowerCase();
    const byId = store.persons.get(ref);
    const named = byId ? [byId] : store.persons.list().filter((x) => x.name.toLowerCase() === key);
    if (named.length > 1) throw badRequest(`${named.length} contacts are called ${ref}; use the id`);
    const p = named[0];
    if (!p) throw notFound(`person ${ref} (add them to your contacts first)`);
    if (p.role === "owner") throw badRequest("a commitment is with someone else, not with the owner");
    if (p.role === "blocked") throw badRequest(`${p.name} is blocked`);
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
      const scope = agentScope(ctx);
      const project = scope ? scope.project : p.project;
      checkAgent(p.assignee, project);
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      if (p.parent) visible(p.parent, ctx);
      const person = p.person ? personOf(p.person) : undefined;
      const due = dueOf(p.due_at);
      const remind = dueOf(p.remind_at);
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
          remind_at: remind ?? undefined,
          kind: p.kind,
          priority: p.priority,
          tags: tagsOf(p.tags),
          person_id: person,
          owed_by: p.owed_by,
          thread_id: thread.id,
          by: by(ctx),
        });
      });
    },
    "tasks.update": ({ task, person, due_at, remind_at, project, tags, ...c }, ctx) => {
      const cur = visible(task, ctx);
      checkStatus(c.status);
      // An agent keeps its tasks in its own project; the owner can move one anywhere (null = global).
      if (project !== undefined && agentScope(ctx))
        throw unauthorized("an agent cannot move a task to another project");
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      const moving = project !== undefined && (project ?? undefined) !== cur.project_id;
      const target = moving ? (project ?? undefined) : cur.project_id;
      checkAgent(c.assignee, target);
      // Its agent stays only if it can work there.
      const keeper = c.assignee !== undefined ? c.assignee : cur.assignee;
      const unassign =
        moving && keeper && store.agents.get(keeper)?.project_id && store.agents.get(keeper)?.project_id !== target;
      // The tray hears of a task when it starts waiting for the owner, not on every later change.
      if (c.awaits_owner && !cur.awaits_owner && cur.state === "open")
        store.notifications.add({ kind: "task", title: cur.title, thread_id: cur.thread_id, ref: cur.id });
      return store.tx(() => {
        if (moving) store.threads.moveTo(cur.thread_id, target);
        return store.tasks.change(
          task,
          {
            ...c,
            ...(moving ? { project_id: target ?? null } : {}),
            ...(unassign ? { assignee: null } : {}),
            ...(tags !== undefined ? { tags: tagsOf(tags) ?? [] } : {}),
            ...(person !== undefined ? { person_id: person === null ? null : personOf(person) } : {}),
            // Someone on the other side makes it a commitment, unless a kind was given.
            ...(person && !c.kind ? { kind: "commitment" as const } : {}),
            ...(due_at !== undefined ? { due_at: dueOf(due_at) } : {}),
            ...(remind_at !== undefined ? { remind_at: dueOf(remind_at) } : {}),
          },
          by(ctx),
        ) as Task;
      });
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
