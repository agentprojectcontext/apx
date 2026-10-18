// Tasks. The owner sees and changes every one; an agent only those of its thread's project and the global ones, and
// what it creates goes to its thread's project. Giving a task to an agent starts its work in that agent's chat for the
// task, and the owner's comment that @mentions its agent asks it there (its answer comes back as a comment) and anyone
// else in a consult shown on the task as a card (task-work.ts). A task an agent creates from a chat about a task is its
// subtask; an agent answering another one gives nobody work (DECISIONS.md#d-079).
import type { Author, Task } from "@apx/protocol";
import { publicRun } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskWaiting } from "../domain/task-attention.ts";
import {
  boardScope,
  checkAssignee,
  checkColumn,
  checkSettle,
  columnsOf,
  dueOf,
  personOf,
  tagsOf,
  visibleTask,
} from "../domain/tasks.ts";
import { ancestors } from "../engine/ancestry.ts";
import type { Engine } from "../engine/engine.ts";
import { ownerMentionProblem } from "../engine/office.ts";
import { reportClose } from "../engine/task-report.ts";
import { type Asker, addComment, askMentioned, startTaskWork } from "../engine/task-work.ts";
import { badRequest, conflict, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import type { Handlers } from "./router.ts";
import { removeThreadFiles } from "./thread-admin.ts";

export function taskHandlers(store: Store, engine: Engine, home: string) {
  const agentScope = (ctx: CallContext) => boardScope(store, ctx.agent);
  const by = (ctx: CallContext) => ctx.agent?.id ?? "owner";
  /** Who is asking for work: the owner, or an agent one hop further than the turn it calls from. */
  const askerOf = (ctx: CallContext): Asker =>
    ctx.agent
      ? {
          kind: "agent",
          id: ctx.agent.id,
          name: store.agents.get(ctx.agent.id)?.name ?? ctx.agent.id,
          thread_id: ctx.agent.thread_id,
          run_id: ctx.agent.run_id,
          depth: (store.runs.get(ctx.agent.run_id)?.depth ?? 0) + 1,
        }
      : { kind: "owner" };

  const visible = (id: string, ctx: CallContext): Task => visibleTask(store, id, agentScope(ctx));
  /** The agent that asked, when this call comes from an agent answering another one (a delegation, a consult). */
  const answering = (ctx: CallContext): string | undefined => {
    const thread = ctx.agent && store.threads.get(ctx.agent.thread_id);
    if (thread?.kind !== "a2a") return undefined;
    const caller = thread.agent_ids.find((id) => id !== ctx.agent?.id);
    return (caller && store.agents.get(caller)?.name) || "the agent that asked you";
  };
  /** The task the agent's chat is about (its own task chat, a consult on a task, or a session under one). */
  const chatTask = (ctx: CallContext): string | undefined => {
    const here = ctx.agent && store.threads.get(ctx.agent.thread_id);
    if (!here) return undefined;
    for (const t of [here, ...ancestors(store, here.id)]) {
      const id = t.task_id ?? store.tasks.byThread(t.id)?.id;
      if (!id) continue;
      try {
        return visible(id, ctx).id;
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  const refuseHandOn = (ctx: CallContext) => {
    const caller = answering(ctx);
    if (caller)
      throw badRequest(
        `assignee: you are answering ${caller}, so you start no task work, yours included: do what you can here yourself, and for a task name the agent in your answer: ${caller} assigns it`,
      );
  };
  /** A close reports to the agent that created the task; from the closer's own chat for it, once that turn ends. */
  const reported = (t: Task, ctx: CallContext): Task => {
    const working = ctx.agent && store.threads.get(ctx.agent.thread_id)?.task_id === t.id;
    if (t.state !== "open" && !working)
      reportClose(store, engine.admit, t.id, {
        immediate: true,
        runStartedAt: ctx.agent ? store.runs.get(ctx.agent.run_id)?.started_at : undefined,
      });
    return t;
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
      const sessions = store.threads.byTask(t.id);
      const consults = store.threads
        .children(t.thread_id)
        .flatMap((id) => store.threads.get(id) ?? [])
        .filter((c) => store.threads.context(c.id).consult);
      const all = [t.thread_id, ...sessions.map((s) => s.id), ...consults.map((c) => c.id)];
      // One line per model, whichever loop ran it.
      const usage = [...Map.groupBy(store.runs.usage("", undefined, all), (u) => u.model)].map(([model, rows]) => ({
        model,
        runs: rows.reduce((n, r) => n + r.runs, 0),
        input: rows.reduce((n, r) => n + r.input, 0),
        output: rows.reduce((n, r) => n + r.output, 0),
      }));
      const subtasks = store.tasks.list({ parent: t.id, limit: 200 }).reverse();
      return { task: t, events: store.tasks.events(t.id), sessions, consults, subtasks, usage };
    },
    "tasks.create": (p, ctx) => {
      checkColumn(store, p.status);
      const scope = agentScope(ctx);
      const project = scope ? scope.project : p.project;
      checkAssignee(store, p.assignee, project);
      if (p.assignee) refuseHandOn(ctx);
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      if (p.parent) visible(p.parent, ctx);
      const parent = p.parent ?? chatTask(ctx);
      const person = p.person ? personOf(store, p.person) : undefined;
      const due = dueOf(p.due_at);
      const remind = dueOf(p.remind_at);
      // The task's conversation: the assignee answers there, or the super-agent until someone is assigned.
      const home = store.threads.get(HOME_THREAD_ID);
      const agent = p.assignee ?? home?.agent_ids[0] ?? "roby";
      const created = store.tx(() => {
        const thread = store.threads.create({ kind: "task", title: p.title, agent_ids: [agent], project_id: project });
        return store.tasks.create({
          title: p.title,
          description: p.description,
          project_id: project,
          assignee: p.assignee,
          status: p.status ?? columnsOf(store)[0]?.id ?? "todo",
          parent_id: parent,
          due_at: due ?? undefined,
          remind_at: remind ?? undefined,
          kind: p.kind,
          priority: p.priority,
          tags: tagsOf(p.tags),
          person_id: person,
          owed_by: p.owed_by,
          thread_id: thread.id,
          by: by(ctx),
          from: ctx.agent ? { thread: ctx.agent.thread_id, run: ctx.agent.run_id } : undefined,
        });
      });
      if (created.assignee) startTaskWork(store, engine.admit, created, created.assignee, askerOf(ctx));
      return created;
    },
    "tasks.update": ({ task, person, due_at, remind_at, project, tags, ...c }, ctx) => {
      const cur = visible(task, ctx);
      checkColumn(store, c.status);
      // An agent keeps its tasks in its own project; the owner can move one anywhere (null = global).
      if (project !== undefined && agentScope(ctx))
        throw unauthorized("an agent cannot move a task to another project");
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      const moving = project !== undefined && (project ?? undefined) !== cur.project_id;
      const target = moving ? (project ?? undefined) : cur.project_id;
      checkAssignee(store, c.assignee, target);
      // Its agent stays only if it can work there.
      const keeper = c.assignee !== undefined ? c.assignee : cur.assignee;
      const unassign =
        moving && keeper && store.agents.get(keeper)?.project_id && store.agents.get(keeper)?.project_id !== target;
      const completing =
        cur.state === "open" &&
        !cur.description.trim() &&
        Boolean(c.description?.trim()) &&
        store.threads.byTask(cur.id).length === 0;
      const starting = !unassign && keeper && (keeper !== cur.assignee || completing);
      if (starting) refuseHandOn(ctx);
      const changed = store.tx(() => {
        noticeTaskWaiting(store, cur, c.awaits_owner ?? cur.awaits_owner);
        if (moving) store.threads.moveTo(cur.thread_id, target);
        return store.tasks.change(
          task,
          {
            ...c,
            ...(moving ? { project_id: target ?? null } : {}),
            ...(unassign ? { assignee: null } : {}),
            ...(tags !== undefined ? { tags: tagsOf(tags) ?? [] } : {}),
            ...(person !== undefined ? { person_id: person === null ? null : personOf(store, person) } : {}),
            // Someone on the other side makes it a commitment, unless a kind was given.
            ...(person && !c.kind ? { kind: "commitment" as const } : {}),
            ...(due_at !== undefined ? { due_at: dueOf(due_at) } : {}),
            ...(remind_at !== undefined ? { remind_at: dueOf(remind_at) } : {}),
          },
          by(ctx),
        ) as Task;
      });
      // Completing a waiting task starts it too; editing one already worked never starts another turn.
      if (changed.assignee && starting) startTaskWork(store, engine.admit, changed, changed.assignee, askerOf(ctx));
      return changed;
    },
    "tasks.close": ({ task, state, note }, ctx) => {
      visible(task, ctx);
      const t = store.tasks.change(
        task,
        { state, ...(state !== "open" ? { awaits_owner: false } : {}) },
        by(ctx),
        note,
      ) as Task;
      return reported(t, ctx);
    },
    "tasks.settle": ({ task, outcome, due_at, note }, ctx) => {
      const t = visible(task, ctx);
      checkSettle(t, outcome, due_at);
      if (outcome === "renegotiated") return store.tasks.renegotiate(task, dueOf(due_at) ?? "", by(ctx), note) as Task;
      const closed = store.tasks.change(
        task,
        { state: outcome === "kept" ? "done" : "dropped", outcome, awaits_owner: false },
        by(ctx),
        note,
      ) as Task;
      return reported(closed, ctx);
    },
    "tasks.delete": ({ task }, ctx) => {
      const t = visible(task, ctx);
      const ids = store.threads.get(t.thread_id) ? store.threads.family(t.thread_id) : [];
      // Refused rather than canceled, as for a chat: a turn half-way through a tool may still be changing things.
      if (store.threads.busy(ids)) throw conflict("something is running in this task's conversation: stop it first");
      const files = store.tx(() => {
        store.notifications.dropThreads(ids);
        store.notifications.resolve("task", t.id);
        store.notifications.resolve("due", t.id);
        store.tasks.remove(t.id);
        return store.threads.remove(ids);
      });
      removeThreadFiles(home, files);
      return { deleted: t.id };
    },
    "tasks.comment": ({ task, text }, ctx) => {
      const t = visible(task, ctx);
      const why = ctx.agent ? ownerMentionProblem(store, text) : undefined;
      if (why)
        throw badRequest(
          `not posted: ${why}. Mention @owner only with one specific question or decision and what they need to know; to stop waiting for them, use task_update awaits_owner:false.`,
        );
      const author: Author = ctx.agent ? { kind: "agent", id: ctx.agent.id } : { kind: "user" };
      return store.tx(() => {
        const message = addComment(store, t, author, text, by(ctx));
        // Only the owner's @mentions ask an agent; an agent asks with `delegate` (DECISIONS.md#d-078).
        const runs = ctx.agent ? [] : askMentioned(store, engine.admit, store.tasks.get(t.id) ?? t, text);
        return { message, runs: runs.map(publicRun) };
      });
    },
  } satisfies Partial<Handlers>;
}
