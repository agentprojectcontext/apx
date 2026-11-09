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
import { taskReviewHandoff } from "../domain/tasks.ts";
import { type HeldTask, previewOf } from "../domain/threads.ts";
import { badRequest, conflict } from "../errors.ts";
import { asWritten, taskWords } from "../tools/tasks.ts";
import { agentTrip, heldNotice, trip } from "./breaker.ts";
import { REVIEW } from "./context.ts";
import { actionsOf, reportCard } from "./delegation.ts";
import type { AdmitFn } from "./engine.ts";
import { mentioned, mentionsOwner, taskCommentAttention } from "./office.ts";
import { outcomeOf } from "./run-outcome.ts";
import { continueTask } from "./task-continue.ts";
import { checkSelfHandoff, markHandoff, runLineage } from "./task-handoff.ts";
import { answersOwner, ownerTurnEnded } from "./task-inbox.ts";
import { MAX_HANDOFF_DEPTH, MAX_REVIEW_ROUNDS } from "./task-limits.ts";
import { closedIn, coordinatedTaskSource, reportClose } from "./task-report.ts";

/** How often assigned tasks that never started are looked at, and how many start each time. */
export const PICKUP_EVERY_MS = 3600_000;
const PICKUP_AT_ONCE = 3;

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
  const assignment = store.tasks.events(task.id).findLast((event) => typeof event.data.assignment_id === "string");
  const origin = originOf(asker);
  if ((origin.kind === "user" || origin.kind === "agent") && typeof assignment?.data.assignment_id === "string")
    origin.task_assignment = { task: task.id, id: assignment.data.assignment_id };
  return admit({
    thread_id: thread.id,
    agent_id: agentId,
    trigger: asker.kind === "owner" ? "user" : "a2a",
    origin,
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
      if (!task || !asker || task.assignee !== h.agent) continue;
      // A new execution since the hold wins; an older task chat is not evidence that this assignment started.
      const heads = taskRunHeads(store, task.id);
      if (h.prior_runs ? JSON.stringify(h.prior_runs) !== JSON.stringify(heads) : store.threads.byTask(task.id).length)
        continue;
      // Reassigned, re-scoped or re-statused since the hold: the owner's later change decides, not this old start.
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
      if (startTaskWork(store, admit, task, h.agent, by)) started++;
    }
  }
  return started;
}

/** The latest run in each existing chat of a task: what a held start was waiting on. */
function taskRunHeads(store: Store, task: string): string[] {
  return store.threads
    .byTask(task)
    .flatMap((t) => {
      const id = store.runs.latestId(t.id);
      return id ? [id] : [];
    })
    .sort();
}

/** Keeps a task an agent gave while its chat's chain is paused, and tells the owner there. */
function hold(store: Store, task: Task, agentId: string, asker: Extract<Asker, { kind: "agent" }>): void {
  const held = (store.threads.context(asker.thread_id).held ?? []).filter((h) => h.task !== task.id);
  const entry: HeldTask = {
    task: task.id,
    agent: agentId,
    run: asker.run_id,
    depth: asker.depth,
    prior_runs: taskRunHeads(store, task.id),
    prior_events: store.tasks.events(task.id).length,
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
  options: { transfer?: boolean; now?: Date } = {},
): RunRecord | undefined {
  // How far agents hand work on is the breaker's, as the owner set it (DECISIONS.md#d-082).
  if (task.state !== "open" || !task.description.trim() || !store.agents.get(agentId)) return undefined;
  // A start time still ahead: the office clock starts it then (startScheduled). A proposal waits for the owner.
  if (startsLater(task, options.now) || task.proposed) return undefined;
  if (asker.kind === "agent" && (trip(store, asker.thread_id) || agentTrip(store, asker.thread_id, agentId))) {
    hold(store, task, agentId, asker);
    return undefined;
  }
  const ownWords = asWritten(store, task).created_by === "owner";
  const assignment = store.tasks.events(task.id).findLast((event) => typeof event.data.assignment_id === "string");
  const review = taskReviewHandoff(assignment?.data.review_handoff);
  const reviewRequest =
    asker.kind === "agent" &&
    review?.author === asker.id &&
    review.reviewer === agentId &&
    assignment?.data.from_run === asker.run_id &&
    assignment.data.from_thread === asker.thread_id;
  const workText = ownWords ? [task.title, task.description].filter(Boolean).join("\n\n") : "Work on this task.";
  const text = reviewRequest ? `Independently review this task's delivery. ${REVIEW}\n\n${workText}` : workText;
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
  // A project's head that starts a task from its own chat is its coordinator: the result of that task returns there.
  // Anyone else's start ends that coordination (DECISIONS.md#d-207).
  const coordinates =
    asker.kind === "agent" && projectCoordinatorChat(store, task, { id: asker.id, thread_id: asker.thread_id });
  store.threads.mergeContext(task.thread_id, {
    coordination_from: coordinates ? { thread: asker.thread_id, run: asker.run_id, work_run: work.id } : undefined,
  });
  const sourceRun = asker.kind === "agent" ? store.runs.get(asker.run_id) : undefined;
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

/** Whether the agent is the project's head, speaking in a project chat that is not a task's own. */
function projectCoordinatorChat(store: Store, task: Task, agent: { id: string; thread_id: string }): boolean {
  const thread = store.threads.get(agent.thread_id);
  return Boolean(
    task.project_id &&
      thread?.project_id === task.project_id &&
      !thread.task_id &&
      (thread.kind === "agent" || thread.kind === "loose") &&
      projectOrchestrator(store.agents.list().filter((a) => a.project_id === task.project_id))?.agent.id === agent.id,
  );
}

/** Reopens a delivery and records the correction request and its run together, or leaves it unchanged. */
export function reworkTask(store: Store, admit: AdmitFn, task: Task, note: string | undefined, asker: Asker): Task {
  if (task.state === "open") throw conflict("rework requires a closed task");
  if (task.proposed) throw conflict("rework requires accepting the proposed task first");
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
 * The consult a new @mention of the same teammate on this task by the same asker goes on in (the latest one, with its
 * context) instead of a new sub-thread. Reviews stay apart, and one still working is left, so asks made in parallel
 * stay parallel (DECISIONS.md#d-190).
 */
function consultToContinue(store: Store, task: Task, agentId: string, asker: string | undefined): Thread | undefined {
  const latest = store.threads.sessions(task.thread_id).find((t) => {
    const c = store.threads.context(t.id).consult;
    return c && !c.review && !t.archived && t.kind === "a2a" && t.agent_ids[0] === agentId && c.asker?.agent === asker;
  });
  return latest && !store.threads.busy([latest.id]) ? latest : undefined;
}

/**
 * A teammate the owner asked on a task: a sub-thread of the task's conversation with the question, and a card there
 * (the teammate's) that its answer fills in. Like a delegation, it holds only the question and the answer. Asked again
 * by the same asker, the teammate goes on in that sub-thread with a new card for the new answer.
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
  const title = how.review
    ? `Review: ${task.title.slice(0, 80)}`
    : `${from} → ${agent.name}: ${previewOf(text).slice(0, 60)}`;
  const again = how.review
    ? undefined
    : consultToContinue(store, task, agent.id, how.asker?.kind === "agent" ? how.asker.id : undefined);
  const sub =
    again ??
    store.threads.create({
      kind: "a2a",
      title,
      agent_ids: [agent.id],
      project_id: task.project_id,
      parent_id: task.thread_id,
      session: `${task.id}-${agent.id}-${Date.now().toString(36)}`.slice(0, 60),
    });
  if (again) store.threads.patch(again.id, { title });
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

/**
 * Why an agent's new task waits for the owner instead of starting: a chain of hand-offs too deep, or work given back to
 * an agent that handed it down the same chain (two agents passing work to and fro). Undefined: it may start.
 */
export function proposalReason(
  store: Store,
  parentId: string | undefined,
  assignee: string | undefined,
  creator: string,
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
  if (chain.length >= MAX_HANDOFF_DEPTH) return `it would be ${chain.length + 1} hand-offs deep`;
  if (assignee && assignee !== creator && chain.some((t) => t.created_by === assignee))
    return "it gives work back up its own chain";
  return undefined;
}

/** Whether a task's start time is still ahead: its work waits until then. */
export const startsLater = (task: Pick<Task, "start_at">, now = new Date()): boolean =>
  Boolean(task.start_at && task.start_at > now.toISOString());

/** The tasks agents gave while paused, kept by these chats until their chain goes on. */
const heldTasks = (store: Store, holders: readonly string[]): string[] =>
  holders.flatMap((id) => (store.threads.context(id).held ?? []).map((h) => h.task));

/** Assigned tasks whose start time came and whose work never began, a few at a time (the office clock, each tick). */
export function startScheduled(store: Store, admit: AdmitFn, now: Date): RunRecord[] {
  // A task an agent gave while paused waits for its chain to go on, never for the clock (DECISIONS.md#d-082).
  return store.taskLanes
    .scheduled(now.toISOString(), heldTasks(store, store.threads.holding()), PICKUP_AT_ONCE)
    .flatMap((id) => store.tasks.get(id) ?? [])
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
  if (task.proposed || task.state !== "open") return undefined;
  const reviewer = task.reviewer ? store.agents.get(task.reviewer) : undefined;
  const rounds = store.threads
    .sessions(task.thread_id)
    .filter((t) => store.threads.context(t.id).consult?.review).length;
  // Paused agents ask no one, and past two rounds the owner decides: the owner checks it, as when no agent is named.
  if (
    !reviewer ||
    reviewer.id === task.assignee ||
    rounds >= MAX_REVIEW_ROUNDS ||
    trip(store, task.thread_id) ||
    agentTrip(store, task.thread_id, reviewer.id)
  ) {
    noticeTaskReview(store, task);
    return undefined;
  }
  store.notifications.resolve("task", `review:${task.id}`);
  const doer = task.assignee ? (store.agents.get(task.assignee)?.name ?? task.assignee) : "its agent";
  const text = `Check task ${task.id}, done by ${doer}, against what it asks, running the checks you can (tests, the page, the data). ${REVIEW}`;
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
 * A review came back: the task's agent gets the report in its chat for the task, as the reviewer's words (an agent's,
 * not the owner's), and decides what to fix before it delivers (DECISIONS.md#d-208). With no agent on it, or its
 * agent paused, the owner hears it is ready to close.
 */
function reviewEnded(store: Store, admit: AdmitFn, task: Task, run: RunRecord, verdict: string): void {
  const reviewer = store.agents.get(run.agent_id);
  const name = reviewer?.name ?? run.agent_id;
  // Closed or taken out of review meanwhile: the verdict stays on its card, nobody is asked.
  if (task.state !== "open" || task.status !== "review" || task.proposed) return;
  const doer = task.assignee && store.agents.get(task.assignee) ? task.assignee : undefined;
  const paused = doer && (trip(store, task.thread_id) || agentTrip(store, task.thread_id, doer));
  if (!doer || paused) {
    noticeTaskReview(store, task, `${name}: ${previewOf(verdict)}`);
    return;
  }
  // Back to its agent, who delivers it; putting it in review again asks for the next round.
  store.tasks.change(task.id, { status: "doing" }, run.agent_id);
  const clean = APPROVED.test(verdict);
  if (!clean) deliverToCoordinator(store, admit, task, run, name, verdict);
  const text = clean
    ? `${name} checked the task and found nothing that fails:\n${verdict.slice(0, 4000)}\n\nIt is yours to deliver: finish what the task asks (publish it if it says so), then close it with task_close.`
    : `${name} checked the task:\n${verdict.slice(0, 4000)}\n\nA report, not a verdict: you own the task. Fix what breaks what was asked; what does not, you may leave and say in your report. Then deliver it, or put it back in review if a fix needs checking.`;
  const asker: Asker = { kind: "agent", id: run.agent_id, name, thread_id: run.thread_id, run_id: run.id, depth: 1 };
  ask(store, admit, task, doer, text, asker, { kind: "agent", id: run.agent_id }, sessionFor(store, task, doer), [
    {
      type: "text",
      text,
      response: responseMetadata(store, task, run, Boolean(textOf(store, run))),
    },
  ]);
}

/**
 * The coordinator that started a task hears a review that sends it back, once per reviewer run and only while its
 * chat may go on: the owner's and the team's rules still decide what the task does next.
 */
export function deliverToCoordinator(
  store: Store,
  admit: AdmitFn,
  task: Task,
  run: RunRecord,
  name: string,
  verdict: string,
): void {
  const from = coordinatedTaskSource(store, task);
  if (!from) return;
  const told = store.threads.context(from.thread).coordination_feedback ?? [];
  if (told.includes(run.id)) return;
  if (trip(store, from.thread) || agentTrip(store, from.thread, from.run.agent_id)) return;
  store.threads.mergeContext(from.thread, { coordination_feedback: [...told, run.id].slice(-50) });
  admit({
    thread_id: from.thread,
    agent_id: from.run.agent_id,
    // A team's result, like the task's close report (reportClose): at the coordinator's depth, no owner standing.
    trigger: "a2a_result",
    origin: {
      kind: "task_feedback",
      task_id: task.id,
      title: task.title,
      agent_id: run.agent_id,
      name,
      run_id: run.id,
    },
    text: verdict.slice(0, 4000),
    depth: from.run.depth,
  });
}

/** The final answer of a run, as text. */
function textOf(store: Store, run: RunRecord): string {
  const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
  // Tool calls sit between an answer's text parts: they must not leave blank lines in the posted comment.
  return (msg?.parts ?? []).flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text.trim()] : [])).join("\n\n");
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
  else continueTask(store, admit, run);
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
  return store.taskLanes
    .unstarted(since, new Date().toISOString(), heldTasks(store, holders), PICKUP_AT_ONCE)
    .flatMap((id) => store.tasks.get(id) ?? [])
    .flatMap((t) => startLater(store, admit, t) ?? []);
}
