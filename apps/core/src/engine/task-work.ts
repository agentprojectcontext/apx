// A task is worked in its agent's own chat for it (listed in the inbox like any chat), never in the task's
// conversation: that one keeps only comments, the owner's and each work turn's final answer posted back by its agent.
// Assigning starts the work; the owner's @mention of its agent, or words written in the task's conversation, reach it
// there (DECISIONS.md#d-101), and an @mention of anyone else opens a short consult
// (the question and its answer, under the task's conversation, shown there as a card); an hourly pickup starts what was
// assigned and never began. An agent's @mention on a task is a consult whose answer comes back to it (DECISIONS.md#d-132).
import type { Author, Part, Task, Thread } from "@apx/protocol";
import { projectOrchestrator } from "../domain/agent-directory.ts";
import { ownerIdentity } from "../domain/owner.ts";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskReview } from "../domain/task-attention.ts";
import { type HeldTask, previewOf } from "../domain/threads.ts";
import { badRequest, conflict } from "../errors.ts";
import { taskWords } from "../tools/tasks.ts";
import { agentTrip, heldNotice, keepWhilePaused, trip } from "./breaker.ts";
import { frameInput } from "./context.ts";
import { actionsOf, reportCard } from "./delegation.ts";
import type { AdmitFn } from "./engine.ts";
import { mentioned, mentionsOwner, taskCommentAttention } from "./office.ts";
import { outcomeOf } from "./run-outcome.ts";
import { continueTask } from "./task-continue.ts";
import { checkSelfHandoff, markHandoff, runLineage } from "./task-handoff.ts";
import { answersOwner, ownerTurnEnded } from "./task-inbox.ts";
import { closedIn, coordinatedTaskSource, reportClose } from "./task-report.ts";

/** How often assigned tasks that never started are looked at, and how many start each time. */
export const PICKUP_EVERY_MS = 3600_000;
const PICKUP_AT_ONCE = 3;
const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Who asked for the work: the owner (assigning, commenting) or another agent, at some depth of hand-offs. */
export type Asker =
  | { kind: "owner" }
  | { kind: "agent"; id: string; name: string; thread_id: string; run_id: string; depth: number };

/** The agent's chat for this task: its latest one, or a new one. */
export function sessionFor(store: Store, task: Task, agentId: string, source?: Thread): Thread {
  const mine = store.threads.byTask(task.id).filter((t) => t.agent_ids[0] === agentId);
  const last = mine.at(-1);
  if (last && !source) return last;
  if (source) {
    const sessions = store.threads.byTask(task.id).flatMap((t) => store.threads.family(t.id));
    if (source.task_id === task.id || store.threads.busy(sessions))
      throw conflict("this task still has active work: finish it before transferring execution");
  }
  const thread = store.threads.create({
    kind: "loose",
    title: task.title,
    agent_ids: [agentId],
    project_id: task.project_id,
    task_id: task.id,
    ...(source?.cwd && source.write ? { cwd: source.cwd, write: source.write } : {}),
  });
  // Lists show how many chats a task has.
  store.tasks.touched(task.id, agentId, "update");
  return thread;
}

const originOf = (asker: Asker): Origin =>
  asker.kind === "owner"
    ? { kind: "user" }
    : { kind: "agent", id: asker.id, name: asker.name, thread_id: asker.thread_id, run_id: asker.run_id };

const depthOf = (asker: Asker) => (asker.kind === "owner" ? 0 : asker.depth);
const OWNER: Asker = { kind: "owner" };

/** A turn of `agentId` in its chat for the task, on what `text` asks (shown there as the asker's message). */
export function ask(
  store: Store,
  admit: AdmitFn,
  task: Task,
  agentId: string,
  text: string,
  asker: Asker,
  author: Author,
  into: Thread = sessionFor(store, task, agentId),
  parts: Part[] = [{ type: "text", text }],
) {
  const thread = into;
  // Work an agent gives spends against the chat it gave it from (DECISIONS.md#d-080).
  if (asker.kind === "agent" && asker.thread_id !== thread.id && !store.threads.context(thread.id).asked_from)
    store.threads.mergeContext(thread.id, { asked_from: asker.thread_id });
  store.messages.add({ thread_id: thread.id, author, parts });
  store.threads.patch(thread.id, { preview: previewOf(text) });
  return admit({
    thread_id: thread.id,
    agent_id: agentId,
    trigger: asker.kind === "owner" ? "user" : "a2a",
    origin: originOf(asker),
    text,
    depth: depthOf(asker),
  });
}

/**
 * Starts the tasks agents gave from these chats while they were paused, in each chat whose chain may go on now (the
 * owner wrote there or let agents go on); returns how many started.
 */
export function startHeld(store: Store, admit: AdmitFn, threadIds: readonly string[]): number {
  let started = 0;
  for (const id of threadIds) {
    const { held } = store.threads.context(id);
    if (!held?.length || trip(store, id)) continue;
    // An agent still past its own budget keeps its tasks until the owner lets it go on.
    const waiting = held.filter((h) => agentTrip(store, id, h.agent));
    store.threads.mergeContext(id, { held: waiting.length ? waiting : undefined });
    for (const h of held) {
      if (waiting.includes(h)) continue;
      const task = store.tasks.get(h.task);
      const asker = store.runs.get(h.run);
      // A new execution since the hold wins; an older task chat is not evidence that this assignment started.
      if (!task || !asker || task.assignee !== h.agent) continue;
      const heads = taskRunHeads(store, task.id);
      if (h.prior_runs ? JSON.stringify(h.prior_runs) !== JSON.stringify(heads) : store.threads.byTask(task.id).length)
        continue;
      if (
        h.prior_events !== undefined &&
        store.tasks
          .events(task.id)
          .slice(h.prior_events)
          .some((e) =>
            ["assignee", "status", "state", "proposed", "description", "start_at", "project_id"].some((k) =>
              Object.hasOwn(e.data, k),
            ),
          )
      )
        continue;
      const name = store.agents.get(asker.agent_id)?.name ?? asker.agent_id;
      const by = { kind: "agent" as const, id: asker.agent_id, name, thread_id: id, run_id: h.run, depth: h.depth };
      const work = startTaskWork(store, admit, task, h.agent, by);
      if (work) {
        if (h.coordination && projectCoordinatorChat(store, task, { id: by.id, thread_id: by.thread_id }))
          store.threads.mergeContext(task.thread_id, {
            coordination_from: { thread: id, run: h.run, work_run: work.id, ...h.coordination },
          });
        started++;
      }
    }
  }
  return started;
}

/** Keeps a task an agent gave while its chat's chain is paused, and tells the owner there. */
function taskRunHeads(store: Store, task: string): string[] {
  return store.threads
    .byTask(task)
    .flatMap((t) => {
      const id = store.runs.latestId(t.id);
      return id ? [id] : [];
    })
    .sort();
}

function hold(
  store: Store,
  task: Task,
  agentId: string,
  asker: Extract<Asker, { kind: "agent" }>,
  coordination?: { root_run?: string },
): void {
  const held = (store.threads.context(asker.thread_id).held ?? []).filter((h) => h.task !== task.id);
  const entry: HeldTask = {
    task: task.id,
    agent: agentId,
    run: asker.run_id,
    depth: asker.depth,
    prior_runs: taskRunHeads(store, task.id),
    prior_events: store.tasks.events(task.id).length,
    ...(coordination ? { coordination } : {}),
  };
  store.threads.mergeContext(asker.thread_id, { held: [...held, entry] });
  const who = store.agents.get(agentId)?.name ?? agentId;
  const notice = heldNotice(store, asker.thread_id, who, task.title.slice(0, 120), agentId);
  if (notice) store.messages.add({ thread_id: asker.thread_id, author: { kind: "system" }, parts: [notice] });
}

/**
 * Starts an agent's work on a task in its chat for it. The task's words are the owner's when the owner wrote it;
 * otherwise the turn is only told to work on it, and reads the task as outside data in its [task] block.
 */
export function startTaskWork(
  store: Store,
  admit: AdmitFn,
  task: Task,
  agentId: string,
  asker: Asker,
  options: { transfer?: boolean; now?: Date; coordination?: { root_run?: string } } = {},
): RunRecord | undefined {
  // How far agents hand work on is the breaker's, as the owner set it (DECISIONS.md#d-082).
  if (task.state !== "open" || !task.description.trim() || !store.agents.get(agentId)) return undefined;
  // A start time still ahead: the office clock starts it then (startScheduled). A proposal waits for the owner.
  if (startsLater(task, options.now) || task.proposed) return undefined;
  if (asker.kind === "agent" && (trip(store, asker.thread_id) || agentTrip(store, asker.thread_id, agentId))) {
    hold(store, task, agentId, asker, options.coordination);
    return undefined;
  }
  const ownWords = task.created_by === "owner";
  const text = ownWords ? [task.title, task.description].filter(Boolean).join("\n\n") : "Work on this task.";
  const author: Author =
    asker.kind === "agent" ? { kind: "agent", id: asker.id } : ownWords ? { kind: "user" } : { kind: "system" };
  const self =
    options.transfer &&
    asker.kind === "agent" &&
    asker.id === agentId &&
    checkSelfHandoff(store, asker, task.project_id);
  const source = self ? store.threads.get(asker.thread_id) : undefined;
  const work = ask(store, admit, task, agentId, text, asker, author, sessionFor(store, task, agentId, source));
  if (self) markHandoff(store, task, asker, work);
  const sourceRun = asker.kind === "agent" ? store.runs.get(asker.run_id) : undefined;
  // A coordinator-created task needs the same feedback route as an existing one it assigned. Record it only once
  // execution really starts and only when the creation event identifies this exact coordinating chat and run.
  if (
    asker.kind === "agent" &&
    sourceRun &&
    sourceRun.agent_id === asker.id &&
    sourceRun.thread_id === asker.thread_id &&
    task.created_by === asker.id &&
    projectCoordinatorChat(store, task, asker)
  ) {
    const created = store.tasks.events(task.id).find((event) => event.op === "create");
    if (created?.data.from_thread === asker.thread_id && created.data.from_run === asker.run_id) {
      // Reuse the owner-lineage verifier; the virtual assignee only asks whether this chat can trace to its root.
      // It grants no task permission and keeps nested or unverified chains uncompressed.
      let root: string | undefined;
      authorizedChildHandoff(store, { ...task, assignee: asker.id }, asker, agentId, {
        allowCoordinatorChat: true,
        onVerifiedRoot: (id) => {
          root = id;
        },
      });
      store.threads.mergeContext(task.thread_id, {
        coordination_from: {
          thread: asker.thread_id,
          run: asker.run_id,
          work_run: work.id,
          ...(root ? { root_run: root } : {}),
        },
      });
    }
  }
  if (asker.kind === "agent" && sourceRun && !sourceRun.ended_at) {
    const previous = store.threads.context(asker.thread_id).task_dispatches;
    const source = { id: asker.run_id, thread_id: asker.thread_id };
    const tasks = previous && runLineage(store, source).includes(previous.run) ? previous.tasks : [];
    const dispatch = { task: task.id, agent: agentId, project: task.project_id };
    const kept = tasks.filter((t) => t.task !== task.id || t.agent !== agentId || t.project !== task.project_id);
    store.threads.mergeContext(asker.thread_id, {
      task_dispatches: { run: asker.run_id, tasks: [...kept, dispatch] },
    });
  }
  return work;
}

/** Reopens a delivery and records the correction request and its run together, or leaves it unchanged. */
export function reworkTask(store: Store, admit: AdmitFn, task: Task, note: string | undefined, asker: Asker): Task {
  if (task.state === "open") throw conflict("rework requires a closed task");
  if (!task.assignee) throw badRequest("rework requires an assignee");
  const reason = note?.trim();
  if (!reason) throw badRequest("rework requires a note explaining the corrections");
  const sessions = store.threads.byTask(task.id);
  const threads = [task.thread_id, ...sessions.flatMap((s) => store.threads.family(s.id))];
  if (store.threads.busy(threads)) throw conflict("task work is still active: wait for it to finish before rework");
  if (asker.kind === "agent" && (trip(store, asker.thread_id) || agentTrip(store, asker.thread_id, task.assignee)))
    throw conflict("rework is paused by agent limits: ask the owner to let the chain continue first");
  const agentId = task.assignee;
  const by = asker.kind === "owner" ? "owner" : asker.id;
  const author: Author = asker.kind === "owner" ? { kind: "user" } : { kind: "agent", id: asker.id };
  return store.tx(() => {
    const reopened = store.tasks.change(task.id, { state: "open", awaits_owner: false }, by, reason) as Task;
    addComment(store, reopened, author, `Corrections requested:\n\n${reason}`, by);
    const run = ask(store, admit, reopened, agentId, `Corrections requested:\n\n${reason}`, asker, author);
    store.tasks.reworkStarted(task.id, by, run.id, run.thread_id);
    return store.tasks.get(task.id) as Task;
  });
}

/**
 * The owner's comment's @mentions. The task's own agent answers in its chat for the task (its answer comes back as a
 * comment); anyone else answers in a consult of its own, so a teammate asked once does not get a whole chat on the task.
 * An agent's @mentions go through `consultFromAgent` instead (DECISIONS.md#d-132).
 */
export function askMentioned(store: Store, admit: AdmitFn, task: Task, text: string): RunRecord[] {
  const who = mentioned(store, text, task.project_id);
  if (!who.length) return [];
  const asked = ownerWordsSinceReply(store, task.thread_id) || text;
  const answering = (run: RunRecord) => {
    answersOwner(store, task, run);
    return run;
  };
  return who.flatMap((a) => {
    const run =
      a.id === task.assignee
        ? answering(ask(store, admit, task, a.id, asked, OWNER, { kind: "user" }))
        : consult(store, admit, task, a, asked);
    return run ? [run] : [];
  });
}

/**
 * The owner's comments since anyone else last spoke on the task, oldest first: a bare "@name" after a question asks
 * that question, not just the name.
 */
function ownerWordsSinceReply(store: Store, threadId: string): string {
  const words: string[] = [];
  for (const m of store.messages.list(threadId, 20).reverse()) {
    if (m.author.kind !== "user") break;
    const text = m.parts
      .map((p) => (p.type === "text" ? p.text : ""))
      .join("\n")
      .trim();
    if (text) words.unshift(text);
  }
  return words.join("\n\n").slice(-4000);
}

/** Teammates one agent's comment asks at once; more is a fan-out it should hand out as tasks instead. */
const MAX_COMMENT_ASKS = 2;

/**
 * An agent's comment on a task @mentioning teammates: each is asked in a consult there, and its answer comes back to
 * the asking agent's chat for the task. Said from inside a consult or a delegation, it asks no one (no chains).
 */
export function consultFromAgent(
  store: Store,
  admit: AdmitFn,
  task: Task,
  by: { id: string; run_id: string; thread_id: string },
  text: string,
): RunRecord[] {
  const agent = store.agents.get(by.id);
  if (!agent || task.state !== "open" || store.threads.get(by.thread_id)?.kind === "a2a") return [];
  if (trip(store, by.thread_id) || agentTrip(store, by.thread_id, by.id)) return [];
  const asker: Asker = {
    kind: "agent",
    id: agent.id,
    name: agent.name,
    thread_id: by.thread_id,
    run_id: by.run_id,
    depth: 1,
  };
  return mentioned(store, text, task.project_id)
    .filter((a) => a.id !== agent.id)
    .slice(0, MAX_COMMENT_ASKS)
    .flatMap((a) => consult(store, admit, task, a, text, { by: agent.id, asker }) ?? []);
}

/** The owner's comment's @mentions of anyone but the task's own agent, each answered in a consult. */
export function consultMentioned(store: Store, admit: AdmitFn, task: Task, text: string): RunRecord[] {
  return mentioned(store, text, task.project_id)
    .filter((a) => a.id !== task.assignee)
    .flatMap((a) => consult(store, admit, task, a, text) ?? []);
}

/** The task whose conversation this is, when an agent has it: that agent works it in its own chat, never here. */
export function assignedTaskOf(store: Store, threadId: string): (Task & { assignee: string }) | undefined {
  const task = store.tasks.byThread(threadId);
  return task?.assignee && store.agents.get(task.assignee) ? { ...task, assignee: task.assignee } : undefined;
}

/**
 * A teammate the owner asked on a task: a sub-thread of the task's conversation with the question, and a card there
 * (the teammate's) that its answer fills in. Like a delegation, it holds only the question and the answer.
 */
function consult(
  store: Store,
  admit: AdmitFn,
  task: Task,
  agent: { id: string; name: string },
  text: string,
  how: { by?: string; trigger?: "user" | "system"; review?: boolean; asker?: Asker } = {},
): RunRecord | undefined {
  const from = (how.asker?.kind === "agent" && how.asker.name) || ownerIdentity(store).name || "The owner";
  const sub = store.threads.create({
    kind: "a2a",
    title: how.review
      ? `Review: ${task.title.slice(0, 80)}`
      : `${from} → ${agent.name}: ${previewOf(text).slice(0, 60)}`,
    agent_ids: [agent.id],
    project_id: task.project_id,
    parent_id: task.thread_id,
    session: `${task.id}-${agent.id}-${Date.now().toString(36)}`.slice(0, 60),
  });
  const who = task.assignee ? (store.agents.get(task.assignee)?.name ?? task.assignee) : "nobody";
  const question = `${text}\n\n[Asked on task ${task.id}, assigned to ${who}. Answer the question; the task's work is not yours unless it says so.]\n${taskWords(task, task.title.slice(0, 200))}`;
  const author: Author = how.asker?.kind === "agent" ? { kind: "agent", id: how.asker.id } : { kind: "user" };
  store.messages.add({ thread_id: sub.id, author, parts: [{ type: "text", text }] });
  const card = store.messages.add({
    thread_id: task.thread_id,
    author: { kind: "agent", id: agent.id },
    // The question is the comment right above: the card names the task instead of repeating it.
    parts: [
      {
        type: "subthread",
        thread_id: sub.id,
        agent_id: agent.id,
        title: task.title.slice(0, 120),
        state: "working",
        asked_by: how.by ?? "owner",
      },
    ],
  });
  store.threads.mergeContext(sub.id, {
    consult: {
      task: task.id,
      card: card.id,
      ...(how.review ? { review: true } : {}),
      ...(how.asker?.kind === "agent" ? { asker: { agent: how.asker.id, thread: how.asker.thread_id } } : {}),
    },
  });
  // Who spoke on the task shows on its conversation, not only its first agent.
  store.threads.join(task.thread_id, agent.id);
  return admit({
    thread_id: sub.id,
    agent_id: agent.id,
    trigger: how.asker ? "a2a" : (how.trigger ?? "user"),
    origin: originOf(how.asker ?? OWNER),
    text: question,
    depth: how.asker ? depthOf(how.asker) : 0,
  });
}

/** Hand-offs above a task an agent may still add to on its own; deeper, its new task is a proposal for the owner. */
const MAX_HANDOFF_DEPTH = 3;
/** Two review rounds are bounded separately from nested delegation. */
const MAX_REVIEW_ROUNDS = 2;

/**
 * Why an agent's new task waits for the owner instead of starting: a chain of hand-offs too deep, or work given back to
 * an agent that handed it down the same chain (two agents passing work to and fro). Undefined: it may start.
 */
export function proposalReason(
  store: Store,
  parentId: string | undefined,
  assignee: string | undefined,
  creator: string,
  options: { ignoreHistoricalDepth?: boolean; ignoreHistoricalBackflow?: boolean } = {},
): string | undefined {
  const chain: Task[] = [];
  const seen = new Set<string>();
  for (let id = parentId; id && !seen.has(id) && chain.length <= MAX_HANDOFF_DEPTH; ) {
    seen.add(id);
    const t = store.tasks.get(id);
    if (!t) break;
    chain.push(t);
    id = t.parent_id;
  }
  if (!options.ignoreHistoricalDepth && chain.length >= MAX_HANDOFF_DEPTH)
    return `it would be ${chain.length + 1} hand-offs deep`;
  if (
    !options.ignoreHistoricalBackflow &&
    assignee &&
    assignee !== creator &&
    chain.some((t) => t.created_by === assignee)
  )
    return "it gives work back up its own chain";
  return undefined;
}

/** Whether a task is being coordinated from its own project's recognized orchestrator chat. */
export function projectCoordinatorChat(
  store: Store,
  task: Task | undefined,
  agent: { id: string; thread_id: string },
): boolean {
  const thread = store.threads.get(agent.thread_id);
  return Boolean(
    task?.project_id &&
      thread?.project_id === task.project_id &&
      !thread.task_id &&
      (thread.kind === "agent" || thread.kind === "loose") &&
      projectOrchestrator(store.agents.list().filter((a) => a.project_id === task.project_id))?.agent.id === agent.id,
  );
}

/** Reconstruct a short owner-origin chain, without trusting stored run depth or task ancestry. */
export function authorizedChildHandoff(
  store: Store,
  parent: Task | undefined,
  agent: { id: string; thread_id: string; run_id: string },
  assignee: string | undefined,
  options: { allowCoordinatorChat?: boolean; allowReviewReturn?: boolean; onVerifiedRoot?: (id: string) => void } = {},
): "allowed" | "limit" | "backflow" | undefined {
  const thread = store.threads.get(agent.thread_id);
  let run = store.runs.get(agent.run_id);
  const coordinatorChat = Boolean(options.allowCoordinatorChat && projectCoordinatorChat(store, parent, agent));
  if (
    parent?.state !== "open" ||
    parent.proposed ||
    parent.awaits_owner ||
    (parent.assignee !== agent.id && !(coordinatorChat && !parent.assignee)) ||
    !thread ||
    (thread.task_id !== parent.id && !coordinatorChat) ||
    run?.thread_id !== thread.id ||
    run.agent_id !== agent.id ||
    run.ended_at
  )
    return undefined;
  if (coordinatorChat && !parent.assignee) {
    const ownerDecision = store.tasks
      .events(parent.id)
      .findLast((e) => e.by === "owner" && (Object.hasOwn(e.data, "assignee") || e.data.proposed === false));
    if (ownerDecision?.data.assignee === null) return undefined;
  }
  const taskAuthority = authorizedExistingHandoff(store, parent, agent, { allowCoordinatorChat: coordinatorChat });
  if (taskAuthority === "limit") return "limit";
  if (taskAuthority === "denied") return undefined;
  const initial = run.input?.origin;
  const assignment = store.tasks.events(parent.id).findLast((e) => Object.hasOwn(e.data, "assignee"));
  const coordination = coordinatedTaskSource(store, parent);
  // A reviewer may return to the task's exact coordinating project head when a decision or correction is needed.
  // This is still bounded by the same verified owner lineage and review-round limits, not a general backflow bypass.
  const coordinatorEscalation = Boolean(
    assignee &&
      coordination?.run.agent_id === assignee &&
      projectCoordinatorChat(store, parent, { id: assignee, thread_id: coordination.thread }),
  );
  const reviewReturn = Boolean(
    options.allowReviewReturn &&
      !coordinatorChat &&
      parent.status === "review" &&
      initial?.kind === "agent" &&
      (initial.id === assignee || coordinatorEscalation) &&
      store.threads.get(initial.thread_id)?.task_id === parent.id &&
      assignment?.by === initial.id &&
      assignment.data.assignee === agent.id &&
      assignment.data.status === "review" &&
      assignment.at <= run.started_at,
  );
  const seen = new Set<string>();
  const agents = new Set<string>();
  let hops = 0;
  let reviewMoves = 0;
  let reviewPair: string | undefined;
  const events = store.tasks.events(parent.id);
  while (run && seen.size < 32 && !seen.has(run.id)) {
    seen.add(run.id);
    agents.add(run.agent_id);
    const input: RunRecord["input"] = run.input;
    if (!input) return undefined;
    const previousId = input.resume_of ?? input.retry_of ?? input.continues;
    if (previousId) {
      const previous = store.runs.get(previousId);
      if (
        !previous ||
        previous.thread_id !== run.thread_id ||
        previous.agent_id !== run.agent_id ||
        previous.started_at > run.started_at
      )
        return undefined;
      run = previous;
      continue;
    }
    const origin: Origin = input.origin;
    if (origin.kind === "input_answer") {
      const answer = store.inputs.get(origin.input_id);
      const previous: RunRecord | undefined = answer ? store.runs.get(answer.run_id) : undefined;
      if (
        run.trigger !== "user" ||
        !answer ||
        !["answered", "approved", "denied"].includes(answer.state) ||
        !answer.answered_at ||
        answer.answered_at > run.started_at ||
        answer.thread_id !== run.thread_id ||
        answer.agent_id !== run.agent_id ||
        !previous ||
        previous.thread_id !== run.thread_id ||
        previous.agent_id !== run.agent_id ||
        !previous.ended_at ||
        previous.ended_at > run.started_at
      )
        return undefined;
      run = previous;
      continue;
    }
    if (origin.kind === "task_continue" || origin.kind === "stalled_task") {
      const previous: RunRecord | undefined = origin.from_run ? store.runs.get(origin.from_run) : undefined;
      if (
        run.trigger !== "system" ||
        store.threads.get(run.thread_id)?.task_id !== origin.task_id ||
        !previous ||
        previous.thread_id !== run.thread_id ||
        previous.agent_id !== run.agent_id ||
        !previous.ended_at ||
        previous.ended_at > run.started_at ||
        (origin.kind === "task_continue" && previous.state !== "completed") ||
        (origin.kind === "stalled_task" && (previous.state === "canceled" || previous.end_reason === "provider_limit"))
      )
        return undefined;
      run = previous;
      continue;
    }
    const scheduledFlow =
      origin.kind === "agent" &&
      run.trigger === "channel" &&
      origin.id.startsWith("client:flow:") &&
      origin.run_id === "" &&
      origin.thread_id === run.thread_id &&
      parent.project_id &&
      store.flowGraphRuns.scheduledAgentRun(
        origin.id.slice("client:flow:".length),
        run.id,
        run.thread_id,
        parent.project_id,
      );
    if (
      (origin.kind === "user" && run.trigger === "user") ||
      (origin.kind === "channel" && origin.role === "owner" && run.trigger === "channel") ||
      scheduledFlow ||
      (origin.kind === "routine" &&
        run.trigger === "routine" &&
        store.threads.get(run.thread_id)?.kind === "routine" &&
        store.routines.ofRun(run.id) === origin.id)
    ) {
      if (store.threads.context(run.thread_id).client) return undefined;
      if (hops + (reviewMoves ? 1 : 0) >= MAX_HANDOFF_DEPTH) return "limit";
      if (reviewReturn && reviewMoves >= MAX_REVIEW_ROUNDS * 2) return "limit";
      if (assignee && assignee !== agent.id && agents.has(assignee) && !reviewReturn) return "backflow";
      // Only a flat, same-agent coordinator lineage can be compacted. Nested handoffs retain their full chain.
      if (coordinatorChat && hops === 0 && reviewMoves === 0 && agents.size === 1 && run.agent_id === agent.id)
        options.onVerifiedRoot?.(run.id);
      return "allowed";
    }
    if (origin.kind === "agent") {
      if (run.trigger !== "a2a") return undefined;
      const previous = store.runs.get(origin.run_id);
      if (
        !previous ||
        previous.thread_id !== origin.thread_id ||
        previous.agent_id !== origin.id ||
        previous.started_at > run.started_at
      )
        return undefined;
      const currentRun = run;
      const reviewEvent =
        options.allowReviewReturn &&
        store.threads.get(run.thread_id)?.task_id === parent.id &&
        store.threads.get(previous.thread_id)?.task_id === parent.id &&
        events.findLast(
          (e) =>
            e.by === origin.id &&
            e.data.assignee === currentRun.agent_id &&
            e.data.status === "review" &&
            e.at >= previous.started_at &&
            e.at <= currentRun.started_at,
        );
      const pair = [origin.id, run.agent_id].sort().join("\0");
      if (reviewEvent && (!reviewPair || reviewPair === pair)) {
        reviewPair = pair;
        reviewMoves++;
      } else hops++;
      run = previous;
      continue;
    }
    if (origin.kind === "delegation_result") {
      const child: RunRecord | undefined = store.runs.get(origin.run_id);
      const previous: RunRecord | undefined = child?.parent_run_id ? store.runs.get(child.parent_run_id) : undefined;
      if (
        run.trigger !== "a2a_result" ||
        !child ||
        child.thread_id !== origin.thread_id ||
        child.agent_id !== origin.agent_id ||
        child.state !== origin.state ||
        !child.ended_at ||
        child.ended_at > run.started_at ||
        !previous ||
        previous.thread_id !== run.thread_id ||
        previous.agent_id !== run.agent_id ||
        previous.started_at > child.started_at
      )
        return undefined;
      run = previous;
      continue;
    }
    if (origin.kind === "task_feedback") {
      const child = store.tasks.get(origin.task_id);
      const feedback = store.runs.get(origin.run_id);
      const coordination = child && coordinatedTaskSource(store, child);
      if (
        run.trigger !== "a2a_result" ||
        !child ||
        !feedback ||
        !coordination ||
        coordination.thread !== run.thread_id ||
        coordination.run.agent_id !== run.agent_id ||
        child.project_id !== store.threads.get(run.thread_id)?.project_id ||
        feedback.agent_id !== origin.agent_id ||
        !feedback.ended_at ||
        feedback.ended_at > run.started_at ||
        !verifiedReviewFeedback(store, child, feedback) ||
        !store.threads.context(child.thread_id).coordination_feedback?.includes(feedback.id)
      )
        return undefined;
      run = coordination.root ?? coordination.run;
      continue;
    }
    if (origin.kind === "task_result") {
      if (run.trigger !== "a2a_result") return undefined;
      const child = store.tasks.get(origin.task_id);
      const events = child && store.tasks.events(child.id);
      const created = events?.find((e) => e.op === "create");
      const closed = events?.findLast((e) => e.op === "done" || e.op === "drop" || e.op === "reopen");
      const taskThread = store.threads.get(run.thread_id);
      const coordination = child && coordinatedTaskSource(store, child);
      if (
        child &&
        coordination?.thread === run.thread_id &&
        coordination.run.agent_id === run.agent_id &&
        child.project_id === taskThread?.project_id &&
        child.state === origin.state &&
        closed?.by === origin.agent_id &&
        closed.op === (origin.state === "done" ? "done" : "drop") &&
        closed.at <= run.started_at &&
        coordination.run.started_at <= closed.at
      ) {
        run = coordination.root ?? coordination.run;
        continue;
      }
      if (
        !child ||
        child.parent_id !== taskThread?.task_id ||
        child.state !== origin.state ||
        created?.by !== run.agent_id ||
        !closed ||
        closed.by !== origin.agent_id ||
        closed.op !== (origin.state === "done" ? "done" : "drop") ||
        closed.at > run.started_at ||
        created.data.from_thread !== run.thread_id ||
        typeof created.data.from_run !== "string"
      )
        return undefined;
      const previous = store.runs.get(created.data.from_run);
      if (
        !previous ||
        previous.thread_id !== run.thread_id ||
        previous.agent_id !== run.agent_id ||
        previous.started_at > created.at ||
        previous.started_at > run.started_at
      )
        return undefined;
      run = previous;
      continue;
    }
    return undefined;
  }
  return undefined;
}

/** An owner-started task may use a bounded new handoff chain, not inherit earlier parents' depth. */
export function authorizedExistingHandoff(
  store: Store,
  task: Task,
  agent: { id: string; thread_id: string; run_id: string },
  options: { allowCoordinatorChat?: boolean } = {},
): "allowed" | "limit" | "denied" | undefined {
  const thread = store.threads.get(agent.thread_id);
  const run = store.runs.get(agent.run_id);
  if (
    task.assignee !== agent.id ||
    !thread ||
    (thread.task_id !== task.id && !options.allowCoordinatorChat) ||
    run?.thread_id !== thread.id ||
    run.agent_id !== agent.id ||
    run.ended_at
  )
    return undefined;
  const events = store.tasks.events(task.id);
  const anchor = events.findLastIndex(
    (e) => e.by === "owner" && (Object.hasOwn(e.data, "assignee") || e.data.proposed === false),
  );
  const authorization = events[anchor];
  if (!authorization) return undefined;
  if (authorization.data.assignee === null || run.started_at < authorization.at) return "denied";
  const initial = events.slice(0, anchor + 1).findLast((e) => Object.hasOwn(e.data, "assignee"))?.data.assignee;
  if (typeof initial !== "string") return "denied";
  let previous: unknown = initial;
  let transfers = 0;
  let reviewMoves = 0;
  let reviewPair: string | undefined;
  for (const event of events.slice(anchor + 1)) {
    if (!Object.hasOwn(event.data, "assignee")) continue;
    const next = event.data.assignee;
    if (next !== previous) {
      if (typeof next !== "string" || event.by !== previous) return "denied";
      const pair = [previous, next].sort().join("\0");
      if (event.data.status === "review" && (!reviewPair || reviewPair === pair)) {
        reviewPair = pair;
        reviewMoves++;
      } else transfers++;
    }
    previous = next;
  }
  if (previous !== task.assignee) return "denied";
  return transfers + (reviewMoves ? 1 : 0) >= MAX_HANDOFF_DEPTH || reviewMoves >= MAX_REVIEW_ROUNDS * 2
    ? "limit"
    : "allowed";
}

/** Whether a task's start time is still ahead: its work waits until then. */
export const startsLater = (task: Pick<Task, "start_at">, now = new Date()): boolean =>
  Boolean(task.start_at && task.start_at > now.toISOString());

/** Assigned tasks whose start time came and whose work never began, a few at a time (the office clock, each tick). */
export function startScheduled(store: Store, admit: AdmitFn, now: Date): RunRecord[] {
  // A task an agent gave while paused waits for its chain to go on, never for the clock (DECISIONS.md#d-082).
  const held = new Set(
    store.threads.holding().flatMap((id) => (store.threads.context(id).held ?? []).map((h) => h.task)),
  );
  return store.tasks
    .list({ state: "open", limit: 500 })
    .filter(
      (t) =>
        t.start_at &&
        !t.proposed &&
        !startsLater(t, now) &&
        t.status !== "review" &&
        !held.has(t.id) &&
        t.assignee &&
        store.agents.get(t.assignee) &&
        t.description.trim() &&
        store.threads.byTask(t.id).length === 0,
    )
    .slice(0, PICKUP_AT_ONCE)
    .flatMap((t) => startLater(store, admit, t, now) ?? []);
}

/**
 * A task started by the office clock (its start time, the hourly pickup), not at its giver's word: as the one who gave
 * it, so an agent's task spends its chain's budget and never starts as if the owner had asked (DECISIONS.md#d-082).
 */
function startLater(store: Store, admit: AdmitFn, task: Task, now?: Date): RunRecord | undefined {
  return startTaskWork(store, admit, task, task.assignee ?? "", askerOfCreation(store, task), now ? { now } : {});
}

/** Who gave the task, for a start that comes later: the owner, or the agent and chat it was created from. */
function askerOfCreation(store: Store, task: Task): Asker {
  if (task.created_by === "owner") return OWNER;
  const from = store.tasks.events(task.id).find((e) => e.op === "create")?.data;
  const thread = typeof from?.from_thread === "string" ? from.from_thread : undefined;
  const run = typeof from?.from_run === "string" ? from.from_run : undefined;
  const agent = store.agents.get(task.created_by);
  if (!thread || !run || !agent) return OWNER;
  // The chain it came from still spends its budget: a tripped one holds it (startTaskWork).
  return { kind: "agent", id: agent.id, name: agent.name, thread_id: thread, run_id: run, depth: 1 };
}

/**
 * A task just put in review: an agent named to check it is asked to, in a consult shown on the task (APX asks, not
 * the owner: no new budget window); otherwise it is the owner's to check, and their tray says so.
 */
export function reviewRequested(store: Store, admit: AdmitFn, task: Task): RunRecord | undefined {
  const reviewer = task.reviewer ? store.agents.get(task.reviewer) : undefined;
  const rounds = store.threads
    .sessions(task.thread_id)
    .filter((t) => store.threads.context(t.id).consult?.review).length;
  // Paused agents ask no one, and past two rounds the owner decides: the owner checks it, as when no agent is named.
  if (
    !reviewer ||
    rounds >= MAX_REVIEW_ROUNDS ||
    trip(store, task.thread_id) ||
    agentTrip(store, task.thread_id, reviewer.id)
  ) {
    noticeTaskReview(store, task);
    return undefined;
  }
  store.notifications.resolve("task", `review:${task.id}`);
  const doer = task.assignee ? (store.agents.get(task.assignee)?.name ?? task.assignee) : "its agent";
  const text = `Review task ${task.id}, done by ${doer}: check the work against what the task asks, running the checks you can (tests, the page, the data). Answer "Approved" (or "Aprobado") with what you checked, or what must change and why.`;
  return consult(store, admit, task, reviewer, text, { by: task.assignee ?? "owner", trigger: "system", review: true });
}

/** A consult ended: its card in the task's conversation shows the answer; it asks no one else. */
function afterConsult(
  store: Store,
  admit: AdmitFn,
  run: RunRecord,
  consulted: { task: string; card: string; review?: boolean; asker?: { agent: string; thread: string } },
): void {
  const task = store.tasks.get(consulted.task);
  const card = store.messages.get(consulted.card);
  const answer = textOf(store, run);
  const index = card?.parts.findIndex((p) => p.type === "subthread") ?? -1;
  const part = card?.parts[index];
  if (card && part?.type === "subthread") {
    const parts = [...card.parts];
    parts[index] = reportCard(
      part,
      run,
      answer || run.error || `(${run.state}, no answer)`,
      outcomeOf(run, Boolean(answer), actionsOf(store, run)),
    );
    store.messages.setPart({ ...card, parts }, index);
  }
  if (!task) return;
  store.tasks.touched(task.id, run.agent_id, "update");
  if (consulted.asker) answerAsker(store, admit, task, run, answer, consulted.asker);
  if (run.state !== "completed" || !answer) return;
  // A consult answers and stops: whoever it @mentions is not asked (DECISIONS.md#d-074).
  taskCommentAttention(store, task, answer, run.agent_id);
  if (consulted.review) reviewEnded(store, admit, store.tasks.get(task.id) ?? task, run, answer);
}

/** The agent that asked on the task hears the answer (or that none came) in its chat for the task, and goes on. */
function answerAsker(
  store: Store,
  admit: AdmitFn,
  task: Task,
  run: RunRecord,
  answer: string,
  from: { agent: string; thread: string },
): void {
  const askerId = from.agent;
  const current = store.tasks.get(task.id) ?? task;
  if (current.state !== "open" || !store.agents.get(askerId)) return;
  const asked = store.threads.get(from.thread);
  // The main chat and a channel's reach the owner's phone: there the asker's reply to a teammate would land on the owner.
  const ownerLine = asked?.kind === "home" || asked?.kind === "channel";
  const thread = asked && !asked.archived && !ownerLine ? asked : sessionFor(store, current, askerId);
  if (trip(store, thread.id) || agentTrip(store, thread.id, askerId)) return;
  const name = store.agents.get(run.agent_id)?.name ?? run.agent_id;
  const text =
    run.state === "completed" && answer
      ? `${name} answered your question on task ${task.id}:\n${answer.slice(0, 4000)}\n\nGo on with the task.`
      : `${name} could not answer your question on task ${task.id} (${run.error ?? run.state}). Go on without it.`;
  const asker: Asker = { kind: "agent", id: run.agent_id, name, thread_id: run.thread_id, run_id: run.id, depth: 1 };
  ask(store, admit, current, askerId, text, asker, { kind: "agent", id: run.agent_id }, thread, [
    {
      type: "text",
      text,
      response: responseMetadata(store, task, run, Boolean(textOf(store, run))),
    },
  ]);
}

function responseMetadata(store: Store, task: Task, run: RunRecord, answered: boolean) {
  const outcome = outcomeOf(run, answered, actionsOf(store, run));
  const issue =
    outcome.level === "warn" && (outcome.issue === "no_answer" || outcome.issue === "actions_failed")
      ? outcome.issue
      : undefined;
  return {
    thread_id: run.thread_id,
    run_id: run.id,
    task_id: task.id,
    title: task.title,
    state: run.state,
    ...(run.end_reason ? { end_reason: run.end_reason } : {}),
    ...(issue ? { issue } : {}),
    ...(store.threads.get(run.thread_id)?.project_id
      ? { project_id: store.threads.get(run.thread_id)?.project_id }
      : {}),
  };
}

/** Reviewers are told to open with this word when nothing must change; one writing in Spanish says it there. */
const APPROVED = /^\W*(approved|aprobad[oa])\b/i;

/**
 * A review came back: approved, the owner hears it is ready to close; with changes asked, the task's agent gets the
 * verdict in its chat for the task, as the reviewer's words (an agent's, not the owner's), and goes on.
 */
function reviewEnded(store: Store, admit: AdmitFn, task: Task, run: RunRecord, verdict: string): void {
  const reviewer = store.agents.get(run.agent_id);
  const name = reviewer?.name ?? run.agent_id;
  // Closed or taken out of review meanwhile: the verdict stays on its card, nobody is asked.
  if (task.state !== "open" || task.status !== "review") return;
  const doer = task.assignee && store.agents.get(task.assignee) ? task.assignee : undefined;
  const paused = doer && (trip(store, task.thread_id) || agentTrip(store, task.thread_id, doer));
  if (APPROVED.test(verdict) || !doer || paused) {
    noticeTaskReview(store, task, `${name}: ${previewOf(verdict)}`);
    return;
  }
  // Back to work, so putting it in review again asks for the next round.
  store.tasks.change(task.id, { status: "doing" }, run.agent_id);
  const text = `${name} reviewed the task and asks for changes:\n${verdict.slice(0, 4000)}\n\nFix what must change, check it, then put it back in review (task_update status review).`;
  const asker: Asker = { kind: "agent", id: run.agent_id, name, thread_id: run.thread_id, run_id: run.id, depth: 1 };
  ask(store, admit, task, doer, text, asker, { kind: "agent", id: run.agent_id }, sessionFor(store, task, doer), [
    {
      type: "text",
      text,
      response: responseMetadata(store, task, run, Boolean(textOf(store, run))),
    },
  ]);
}

/** The final answer of a run, as text. */
function textOf(store: Store, run: RunRecord): string {
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  return (msg?.parts ?? [])
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

/** A comment on the task, by the owner or an agent: the task moved, and an @owner asks for the owner's attention. */
export function addComment(store: Store, task: Task, author: Author, text: string, by: string) {
  const message = store.messages.add({ thread_id: task.thread_id, author, parts: [{ type: "text", text }] });
  if (author.kind === "agent") store.threads.join(task.thread_id, author.id);
  store.threads.patch(task.thread_id, { preview: previewOf(text) });
  taskCommentAttention(store, task, text, by);
  store.tasks.touched(task.id, by);
  return message;
}

/** A completed review returning work to its original author, never a proposal or arbitrary update. */
function verifiedReviewFeedback(store: Store, task: Task, run: RunRecord): boolean {
  const origin = run.input?.origin;
  if (
    run.state !== "completed" ||
    !run.ended_at ||
    origin?.kind !== "agent" ||
    store.threads.get(run.thread_id)?.task_id !== task.id ||
    task.proposed
  )
    return false;
  const previous = store.runs.get(origin.run_id);
  if (
    !previous ||
    previous.agent_id !== origin.id ||
    previous.thread_id !== origin.thread_id ||
    store.threads.get(previous.thread_id)?.task_id !== task.id
  )
    return false;
  const endedAt = run.ended_at;
  return store.tasks
    .events(task.id)
    .some(
      (e) =>
        e.by === run.agent_id &&
        e.data.assignee === origin.id &&
        e.data.status === "review" &&
        e.data.proposed !== true &&
        e.at >= run.started_at &&
        e.at <= endedAt,
    );
}

/** Report once, durably, to the coordinator who actually dispatched this task. */
function reportReviewFeedback(store: Store, admit: AdmitFn, task: Task, run: RunRecord, text: string): void {
  if (!verifiedReviewFeedback(store, task, run)) return;
  const source = coordinatedTaskSource(store, task);
  const reviewer = store.agents.get(run.agent_id);
  if (!source || !reviewer) return;
  store.tx(() => {
    const seen = store.threads.context(task.thread_id).coordination_feedback ?? [];
    if (seen.includes(run.id)) return;
    const origin: Origin = {
      kind: "task_feedback",
      task_id: task.id,
      title: task.title.slice(0, 120),
      agent_id: reviewer.id,
      name: reviewer.name,
      run_id: run.id,
    };
    const note = `A review returned while agents were paused:\n${frameInput(origin, text)}`;
    if (!keepWhilePaused(store, { thread_id: source.thread, agent_id: source.run.agent_id, who: reviewer.name, note }))
      admit({
        thread_id: source.thread,
        agent_id: source.run.agent_id,
        trigger: "a2a_result",
        origin,
        text: text.slice(0, 4000),
        depth: source.run.depth,
      });
    store.threads.mergeContext(task.thread_id, { coordination_feedback: [...seen, run.id] });
  });
}

/**
 * After a turn in a task's chat: the task moved; its answer is posted on the task when the turn closes it (the report;
 * a close reports to the creator), answers the owner, or asks the owner (@owner). Anything else stays in the chat:
 * agents comment on the task on purpose, with task_comment.
 */
export function afterWorkTurn(store: Store, admit: AdmitFn, run: RunRecord): void {
  const thread = store.threads.get(run.thread_id);
  const consulted = thread?.kind === "a2a" ? store.threads.context(thread.id).consult : undefined;
  if (consulted) {
    afterConsult(store, admit, run, consulted);
    return;
  }
  const task = thread?.task_id ? store.tasks.get(thread.task_id) : undefined;
  if (!task) return;
  const text = run.state === "completed" ? textOf(store, run) : "";
  if (run.state !== "completed") store.tasks.touched(task.id, run.agent_id, "update");
  const owners = ownerTurnEnded(store, task, run);
  const closed = closedIn(store, store.tasks.get(task.id) ?? task, run);
  if (text && (closed || owners || mentionsOwner(store, text)))
    addComment(store, task, { kind: "agent", id: run.agent_id }, text, run.agent_id);
  // Closed in this turn: whoever created the task hears now, with the answer just posted as its report.
  if (closed) reportClose(store, admit, task.id);
  else {
    reportReviewFeedback(store, admit, task, run, text);
    continueTask(store, admit, run);
  }
}

/** When a task was last given to its agent (its creation with one, or the last assignment). */
function assignedAt(store: Store, task: Task): string | undefined {
  return store.tasks
    .events(task.id)
    .filter((e) => (e.op === "assign" || e.op === "create") && typeof e.data.assignee === "string")
    .at(-1)?.at;
}

/**
 * The hourly pickup: open tasks assigned to an agent (since this way of working began) that never started, the most
 * pressing first (priority, then the nearest due date), a few at a time.
 */
export function pickUpTasks(store: Store, admit: AdmitFn): RunRecord[] {
  const since = store.settings.get("task_work_since");
  if (!since) return [];
  // A task an agent gave while paused waits for its chain to go on, never for the clock (DECISIONS.md#d-082).
  const holders = store.threads.holding();
  startHeld(store, admit, holders);
  const held = new Set(holders.flatMap((id) => store.threads.context(id).held ?? []).map((h) => h.task));
  const waiting = store.tasks
    .list({ state: "open", limit: 500 })
    .filter(
      (t) =>
        t.assignee &&
        t.description.trim() &&
        !held.has(t.id) &&
        t.status !== "review" &&
        !t.proposed &&
        !startsLater(t) &&
        store.agents.get(t.assignee) &&
        store.threads.byTask(t.id).length === 0 &&
        (assignedAt(store, t) ?? "") >= since,
    )
    .sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.due_at ?? "￿").localeCompare(b.due_at ?? "￿"),
    );
  return waiting.slice(0, PICKUP_AT_ONCE).flatMap((t) => startLater(store, admit, t) ?? []);
}
