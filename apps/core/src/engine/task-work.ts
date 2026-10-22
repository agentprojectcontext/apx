// A task is worked in its agent's own chat for it (listed in the inbox like any chat), never in the task's
// conversation: that one keeps only comments, the owner's and each work turn's final answer posted back by its agent.
// Assigning starts the work; the owner's @mention of its agent, or words written in the task's conversation, reach it
// there (DECISIONS.md#d-101), and an @mention of anyone else opens a short consult
// (the question and its answer, under the task's conversation, shown there as a card); an hourly pickup starts what was
// assigned and never began. An agent's @mention on a task is a consult whose answer comes back to it (DECISIONS.md#d-132).
import type { Author, Task, Thread } from "@apx/protocol";
import { ownerIdentity } from "../domain/owner.ts";
import type { Origin, RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { noticeTaskReview } from "../domain/task-attention.ts";
import { type HeldTask, previewOf } from "../domain/threads.ts";
import { badRequest, conflict } from "../errors.ts";
import { taskWords } from "../tools/tasks.ts";
import { agentTrip, heldNotice, trip } from "./breaker.ts";
import { reportCard } from "./delegation.ts";
import type { AdmitFn } from "./engine.ts";
import { mentioned, mentionsOwner, taskCommentAttention } from "./office.ts";
import { answersOwner, ownerTurnEnded } from "./task-inbox.ts";
import { closedIn, reportClose } from "./task-report.ts";

/** How often assigned tasks that never started are looked at, and how many start each time. */
export const PICKUP_EVERY_MS = 3600_000;
const PICKUP_AT_ONCE = 3;
const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Who asked for the work: the owner (assigning, commenting) or another agent, at some depth of hand-offs. */
export type Asker =
  | { kind: "owner" }
  | { kind: "agent"; id: string; name: string; thread_id: string; run_id: string; depth: number };

/** The agent's chat for this task: its latest one, or a new one. */
export function sessionFor(store: Store, task: Task, agentId: string): Thread {
  const mine = store.threads.byTask(task.id).filter((t) => t.agent_ids[0] === agentId);
  const last = mine.at(-1);
  if (last) return last;
  const thread = store.threads.create({
    kind: "loose",
    title: task.title,
    agent_ids: [agentId],
    project_id: task.project_id,
    task_id: task.id,
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
) {
  const thread = into;
  // Work an agent gives spends against the chat it gave it from (DECISIONS.md#d-080).
  if (asker.kind === "agent" && asker.thread_id !== thread.id && !store.threads.context(thread.id).asked_from)
    store.threads.mergeContext(thread.id, { asked_from: asker.thread_id });
  store.messages.add({ thread_id: thread.id, author, parts: [{ type: "text", text }] });
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
      // Reassigned or begun meanwhile: whoever has it now goes on as it is.
      if (!task || !asker || task.assignee !== h.agent || store.threads.byTask(task.id).length) continue;
      const name = store.agents.get(asker.agent_id)?.name ?? asker.agent_id;
      const by = { kind: "agent" as const, id: asker.agent_id, name, thread_id: id, run_id: h.run, depth: h.depth };
      if (startTaskWork(store, admit, task, h.agent, by)) started++;
    }
  }
  return started;
}

/** Keeps a task an agent gave while its chat's chain is paused, and tells the owner there. */
function hold(store: Store, task: Task, agentId: string, asker: Extract<Asker, { kind: "agent" }>): void {
  const held = (store.threads.context(asker.thread_id).held ?? []).filter((h) => h.task !== task.id);
  const entry: HeldTask = { task: task.id, agent: agentId, run: asker.run_id, depth: asker.depth };
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
): RunRecord | undefined {
  // How far agents hand work on is the breaker's, as the owner set it (DECISIONS.md#d-082).
  if (task.state !== "open" || !task.description.trim() || !store.agents.get(agentId)) return undefined;
  // A start time still ahead: the office clock starts it then (startScheduled). A proposal waits for the owner.
  if (startsLater(task) || task.proposed) return undefined;
  if (asker.kind === "agent" && (trip(store, asker.thread_id) || agentTrip(store, asker.thread_id, agentId))) {
    hold(store, task, agentId, asker);
    return undefined;
  }
  const ownWords = task.created_by === "owner";
  const text = ownWords ? [task.title, task.description].filter(Boolean).join("\n\n") : "Work on this task.";
  const author: Author =
    asker.kind === "agent" ? { kind: "agent", id: asker.id } : ownWords ? { kind: "user" } : { kind: "system" };
  return ask(store, admit, task, agentId, text, asker, author);
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

/** Review rounds an agent reviewer gets on one task before the owner decides. */
const MAX_REVIEW_ROUNDS = 2;

/** Whether a task's start time is still ahead: its work waits until then. */
export const startsLater = (task: Task, now = new Date()): boolean =>
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
    .flatMap((t) => startTaskWork(store, admit, t, t.assignee ?? "", askerOfCreation(store, t)) ?? []);
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
    parts[index] = reportCard(part, run, answer || run.error || `(${run.state}, no answer)`);
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
  const thread = asked && !asked.archived ? asked : sessionFor(store, current, askerId);
  if (trip(store, thread.id) || agentTrip(store, thread.id, askerId)) return;
  const name = store.agents.get(run.agent_id)?.name ?? run.agent_id;
  const text =
    run.state === "completed" && answer
      ? `${name} answered your question on task ${task.id}:\n${answer.slice(0, 4000)}\n\nGo on with the task.`
      : `${name} could not answer your question on task ${task.id} (${run.error ?? run.state}). Go on without it.`;
  const asker: Asker = { kind: "agent", id: run.agent_id, name, thread_id: run.thread_id, run_id: run.id, depth: 1 };
  ask(store, admit, current, askerId, text, asker, { kind: "agent", id: run.agent_id }, thread);
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
  ask(store, admit, task, doer, text, asker, { kind: "agent", id: run.agent_id });
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
  return waiting
    .slice(0, PICKUP_AT_ONCE)
    .flatMap((t) => startTaskWork(store, admit, t, t.assignee ?? "", { kind: "owner" }) ?? []);
}
