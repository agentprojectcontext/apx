// Tasks. Scoped agents use their thread's project and global tasks; the global super-agent may choose any project.
// Giving a task to an agent starts its work in that agent's chat for the
// task, and the owner's comment that @mentions its agent asks it there (its answer comes back as a comment) and anyone
// else in a consult shown on the task as a card (task-work.ts). A task an agent creates from a chat about a task is its
// subtask; an agent answering another one gives nobody work (DECISIONS.md#d-079).
import type { Author, Task } from "@apx/protocol";
import { publicRun } from "../domain/runs.ts";
import { HOME_THREAD_ID } from "../domain/seed.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskProposed, noticeTaskWaiting } from "../domain/task-attention.ts";
import {
  boardScope,
  checkAssignee,
  checkColumn,
  checkSettle,
  columnsOf,
  dueOf,
  personOf,
  tagsOf,
  taskProject,
  visibleTask,
} from "../domain/tasks.ts";
import { ancestors } from "../engine/ancestry.ts";
import { agentTrip, trip } from "../engine/breaker.ts";
import type { Engine } from "../engine/engine.ts";
import { ownerMentionProblem } from "../engine/office.ts";
import { checkSelfHandoff } from "../engine/task-handoff.ts";
import { awaitAgent } from "../engine/task-inbox.ts";
import { reportClose } from "../engine/task-report.ts";
import {
  type Asker,
  addComment,
  askMentioned,
  consultFromAgent,
  proposalReason,
  reviewRequested,
  reworkTask,
  startsLater,
  startTaskWork,
} from "../engine/task-work.ts";
import { badRequest, conflict, notFound, unauthorized } from "../errors.ts";
import type { CallContext } from "./context.ts";
import { assetCaller } from "./media-access.ts";
import type { Handlers } from "./router.ts";
import { taskAssets } from "./task-assets.ts";
import { removeThreadFiles } from "./thread-admin.ts";

export function taskHandlers(
  store: Store,
  engine: Engine,
  home: string,
  beforeDelete?: (ids: string[]) => Promise<void>,
) {
  const assets = taskAssets(store, home);
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
  /** The agent that asked, when this call comes from an agent answering another one (a delegation). */
  const answering = (ctx: CallContext): string | undefined => {
    const thread = ctx.agent && store.threads.get(ctx.agent.thread_id);
    if (thread?.kind !== "a2a") return undefined;
    // A consult is the owner asking on a task, so the work they ask for may be handed out (DECISIONS.md#d-079).
    if (store.threads.context(thread.id).consult) return undefined;
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
  /** Who checks a task in review: undefined leaves it, null (or "owner") is the owner, else an agent of its project. */
  const reviewerOf = (reviewer: string | null | undefined, project: string | undefined): string | null | undefined => {
    if (reviewer === undefined) return undefined;
    if (reviewer === null || ["owner", "me", "yo", "vos"].includes(reviewer.trim().toLowerCase())) return null;
    const found = store.agents.resolve(reviewer, project);
    if ("error" in found) throw badRequest(`reviewer: ${found.error}`);
    return found.agent.id;
  };
  /** Agent-created subtasks must be executable when recorded; owner drafts remain a deliberate choice. */
  const requireSubtaskWork = (
    ctx: CallContext,
    parent: string | undefined,
    assignee: string | null | undefined,
    description: string | undefined,
  ): void => {
    if (!parent || (ctx.actor !== "agent" && !ctx.agent)) return;
    if (!assignee)
      throw badRequest(
        "assignee: a subtask needs a responsible agent; create it with an assignee and description, or propose the work to your caller without creating a task",
      );
    if (!description?.trim())
      throw badRequest("description: a subtask needs a non-empty specification so its assigned agent can start");
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

  const checkTransfer = (
    ctx: CallContext,
    candidate: {
      assignee?: string | null;
      description?: string;
      project_id?: string;
      proposed?: boolean;
      start_at?: string;
    },
  ) => {
    if (
      !ctx.agent ||
      candidate.assignee !== ctx.agent.id ||
      !candidate.description?.trim() ||
      candidate.proposed ||
      startsLater(candidate) ||
      trip(store, ctx.agent.thread_id) ||
      agentTrip(store, ctx.agent.thread_id, ctx.agent.id)
    )
      return;
    checkSelfHandoff(store, askerOf(ctx), candidate.project_id);
  };

  return {
    "tasks.attach": ({ task, media_ids }, ctx) => {
      assetCaller(store, ctx);
      const t = visible(task, ctx);
      const sources = assets.prepare(media_ids, ctx);
      assets.write((attach) => attach(t, sources, ctx));
      return { attachments: assets.list(task) };
    },
    "tasks.detach": ({ task, media_id }, ctx) => assets.detach(visible(task, ctx), media_id, ctx),
    "tasks.list": ({ project, state, assignee, commitments, person, limit }, ctx) => {
      const scope = agentScope(ctx);
      const projects = scope ? [scope.project, undefined] : project ? [project] : undefined;
      return {
        tasks: store.tasks.list({ projects, state: state ?? "open", assignee, commitments, person, limit }),
        columns: columnsOf(store),
      };
    },
    "tasks.get": ({ task }, ctx) => {
      const scope = agentScope(ctx);
      const found = store.tasks.get(task);
      if (!found || (scope && found.project_id && found.project_id !== scope.project))
        throw notFound("task unavailable");
      const t = found;
      const owner = ctx.actor === "human" && !ctx.agent && !ctx.client && !ctx.channel;
      const readable = (thread: { id: string; project_id?: string | undefined }) =>
        (owner || !store.threads.context(thread.id).client) &&
        (!scope || !thread.project_id || thread.project_id === scope.project);
      const sessions = store.threads.byTask(t.id).filter(readable);
      const consults = store.threads
        .children(t.thread_id)
        .flatMap((id) => store.threads.get(id) ?? [])
        .filter((c) => store.threads.context(c.id).consult && readable(c));
      const conversation = store.threads.get(t.thread_id);
      const root = conversation && readable(conversation) ? [t.thread_id] : [];
      const all = [...new Set([...root, ...sessions.map((s) => s.id), ...consults.map((c) => c.id)])];
      // One line per model, whichever loop ran it.
      const usage = [...Map.groupBy(store.runs.usage("", undefined, all), (u) => u.model)].map(([model, rows]) => ({
        model,
        runs: rows.reduce((n, r) => n + r.runs, 0),
        input: rows.reduce((n, r) => n + r.input, 0),
        output: rows.reduce((n, r) => n + r.output, 0),
      }));
      const subtasks = store.tasks
        .list({ parent: t.id, limit: 200 })
        .filter((child) => !scope || !child.project_id || child.project_id === scope.project)
        .reverse();
      const comments = root.length ? store.messages.list(t.thread_id, 61) : [];
      let readsAssets = false;
      try {
        assetCaller(store, ctx);
        readsAssets = true;
      } catch {
        /* Metadata readers do not inherit file access. */
      }
      return {
        task: t,
        events: store.tasks.events(t.id),
        attachments: root.length && readsAssets ? assets.list(t.id) : [],
        sessions,
        consults,
        subtasks,
        usage,
        comments: comments.slice(-60),
        comments_truncated: comments.length > 60,
      };
    },
    "tasks.create": (p, ctx) => {
      checkColumn(store, p.status);
      const project = taskProject(store, ctx.agent, p);
      checkAssignee(store, p.assignee, project);
      // A proposal starts nothing, so even an agent answering another one may make it (for the owner to decide).
      if (p.assignee && !p.propose) refuseHandOn(ctx);
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      if (p.parent) visible(p.parent, ctx);
      const parent = p.parent ?? chatTask(ctx);
      requireSubtaskWork(ctx, parent, p.assignee, p.description);
      const person = p.person ? personOf(store, p.person) : undefined;
      const due = dueOf(p.due_at);
      const remind = dueOf(p.remind_at);
      const start = dueOf(p.start_at);
      const forced = ctx.agent ? proposalReason(store, parent, p.assignee, ctx.agent.id) : undefined;
      const proposed = Boolean(p.propose) || Boolean(forced);
      checkTransfer(ctx, {
        assignee: p.assignee,
        description: p.description,
        project_id: project,
        proposed,
        start_at: start ?? undefined,
      });
      // The task's conversation: the assignee answers there, or the super-agent until someone is assigned.
      const home = store.threads.get(HOME_THREAD_ID);
      const agent = p.assignee ?? home?.agent_ids[0] ?? "roby";
      const sources = assets.prepare(p.attachments, ctx);
      const created = assets.write((attach) => {
        const thread = store.threads.create({ kind: "task", title: p.title, agent_ids: [agent], project_id: project });
        const task = store.tasks.create({
          title: p.title,
          description: p.description,
          project_id: project,
          assignee: p.assignee,
          status: p.status ?? columnsOf(store)[0]?.id ?? "todo",
          parent_id: parent,
          due_at: due ?? undefined,
          remind_at: remind ?? undefined,
          start_at: start ?? undefined,
          proposed,
          kind: p.kind,
          priority: p.priority,
          tags: tagsOf(p.tags),
          person_id: person,
          owed_by: p.owed_by,
          thread_id: thread.id,
          by: by(ctx),
          from: ctx.agent ? { thread: ctx.agent.thread_id, run: ctx.agent.run_id } : undefined,
        });
        attach(task, sources, ctx);
        if (!proposed && task.assignee)
          startTaskWork(store, engine.admit, task, task.assignee, askerOf(ctx), { transfer: true });
        return task;
      });
      if (proposed) {
        noticeTaskProposed(store, created);
        return created;
      }
      if (created.status === "review") reviewRequested(store, engine.admit, created);
      return created;
    },
    "tasks.update": (
      { task, attachments, person, due_at, remind_at, start_at, reviewer, project, tags, ...c },
      ctx,
    ) => {
      const cur = visible(task, ctx);
      checkColumn(store, c.status);
      // An agent keeps its tasks in its own project; the owner can move one anywhere (null = global).
      if (project !== undefined && agentScope(ctx))
        throw unauthorized("an agent cannot move a task to another project");
      if (project && !store.projects.get(project)) throw notFound(`project ${project}`);
      const moving = project !== undefined && (project ?? undefined) !== cur.project_id;
      const target = moving ? (project ?? undefined) : cur.project_id;
      checkAssignee(store, c.assignee, target);
      const checker = reviewerOf(reviewer, target);
      if (c.proposed === false && agentScope(ctx)) throw unauthorized("only the owner accepts a proposed task");
      const accepting = Boolean(cur.proposed) && c.proposed === false;
      // Its agent stays only if it can work there.
      const keeper = c.assignee !== undefined ? c.assignee : cur.assignee;
      if (checker && checker === keeper) throw badRequest("reviewer: the agent doing it does not review its own work");
      const unassign =
        moving && keeper && store.agents.get(keeper)?.project_id && store.agents.get(keeper)?.project_id !== target;
      const completing =
        cur.state === "open" &&
        !cur.description.trim() &&
        Boolean(c.description?.trim()) &&
        store.threads.byTask(cur.id).length === 0;
      if (moving || c.assignee !== undefined || c.description !== undefined)
        requireSubtaskWork(ctx, cur.parent_id, unassign ? null : keeper, c.description ?? cur.description);
      // Its start moved to now (or cleared) before its work began: it begins now.
      const unscheduled =
        start_at !== undefined &&
        Boolean(cur.start_at) &&
        !startsLater({ ...cur, start_at: dueOf(start_at) ?? undefined }) &&
        store.threads.byTask(cur.id).length === 0;
      const starting = !unassign && keeper && (keeper !== cur.assignee || completing || unscheduled || accepting);
      if (starting) {
        refuseHandOn(ctx);
        checkTransfer(ctx, {
          ...cur,
          ...c,
          assignee: keeper,
          project_id: target,
          start_at: start_at === undefined ? cur.start_at : (dueOf(start_at) ?? undefined),
        });
      }
      const sources = assets.prepare(attachments, ctx);
      const changed = assets.write((attach) => {
        attach(cur, sources, ctx);
        noticeTaskWaiting(store, cur, c.awaits_owner ?? cur.awaits_owner);
        if (moving) store.threads.moveTo(cur.thread_id, target);
        const updated = store.tasks.change(
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
            ...(start_at !== undefined ? { start_at: dueOf(start_at) } : {}),
            ...(checker !== undefined ? { reviewer: checker } : {}),
          },
          by(ctx),
        ) as Task;
        if (updated.assignee && starting)
          startTaskWork(store, engine.admit, updated, updated.assignee, askerOf(ctx), { transfer: true });
        return updated;
      });
      // Put in review (or given another checker while in review): whoever checks it hears now.
      const reviewing = changed.state === "open" && changed.status === "review";
      // An agent answering another one (or inside a review) asks no reviewer: no loop of reviews.
      if (
        reviewing &&
        !answering(ctx) &&
        (cur.status !== "review" || (checker !== undefined && checker !== (cur.reviewer ?? null)))
      )
        reviewRequested(store, engine.admit, changed);
      return changed;
    },
    "tasks.close": ({ task, state, note, rework }, ctx) => {
      const cur = visible(task, ctx);
      if (rework) {
        if (state !== "open") throw badRequest("rework requires state:open");
        refuseHandOn(ctx);
        checkAssignee(store, cur.assignee, cur.project_id);
        return reworkTask(store, engine.admit, cur, note, askerOf(ctx));
      }
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
    "tasks.delete": async ({ task }, ctx) => {
      const t = visible(task, ctx);
      const ids = store.threads.get(t.thread_id) ? store.threads.family(t.thread_id) : [];
      // Refused rather than canceled, as for a chat: a turn half-way through a tool may still be changing things.
      if (store.threads.busy(ids)) throw conflict("something is running in this task's conversation: stop it first");
      await beforeDelete?.(ids);
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
        // An agent's @mentions are consults whose answers come back to it (DECISIONS.md#d-132).
        const current = store.tasks.get(t.id) ?? t;
        const runs = ctx.agent
          ? consultFromAgent(store, engine.admit, current, ctx.agent, text)
          : askMentioned(store, engine.admit, current, text);
        // Naming no one, it waits for the task's agent (or the super-agent) to pick it up (engine/task-inbox.ts).
        if (ctx.actor === "human" && !runs.length) awaitAgent(store, t, message.id);
        return { message, runs: runs.map(publicRun) };
      });
    },
  } satisfies Partial<Handlers>;
}
