// The one way an agent asks another: a sub-thread with a durable child run. The caller may wait for it inside its
// turn; past that (or when the caller's turn ends for any reason) the result comes back to the caller's thread as
// a new input. See DECISIONS.md#d-009
import type { Part, Thread, WritePolicy } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { previewOf, strictestWrite, type Worker, worksInFolder } from "../domain/threads.ts";
import { agentReply } from "../tools/agents.ts";
import { folderInProject } from "../tools/folders.ts";
import { modeOf, withProjectAutonomy } from "../tools/policy.ts";
import { ancestors } from "./ancestry.ts";
import { agentTripped, heldNotice, tripped } from "./breaker.ts";
import type { Display } from "./display.ts";
import { MAX_ACTIVE_DELEGATIONS, MAX_DEPTH } from "./limits.ts";

export type Caller = { run: RunRecord; agent: AgentRecord; display: Display };

/**
 * Whom to ask: an agent (a new session), a session by name or id (the same agent, with its context), or both. A
 * worker instead of an agent is the caller itself under instructions it writes for the task.
 */
export type DelegateTo = {
  agent?: AgentRecord | undefined;
  session?: string | undefined;
  worker?: Worker | undefined;
  /** The project the task is about: the session works in its folder. */
  project?: string | undefined;
  /** A folder inside that project to work in (relative to it, or absolute), instead of its root. */
  folder?: string | undefined;
  /** How far the session may change that folder: never further than the caller may. */
  write?: WritePolicy | undefined;
};

/** Where a delegated session works in a folder: the folder and the write policy it gets. */
type Workspace = { cwd: string; write: WritePolicy };

/**
 * The folder a delegation works in, when the caller named one or a write policy (then the project's root), or why
 * not. Its write policy is the strictest of the caller's thread, the caller's autonomy (its project's when it has
 * none) and the one asked for: a delegation never gets further than its caller (DECISIONS.md#d-104).
 */
export function workspaceOf(
  store: Store,
  caller: AgentRecord,
  parent: Thread,
  projectId: string | undefined,
  req: Pick<DelegateTo, "folder" | "write">,
): Workspace | undefined | string {
  if (req.folder === undefined && !req.write) return undefined;
  let cwd: string;
  try {
    cwd = folderInProject(store, projectId, req.folder);
  } catch (err) {
    const why = (err as Error).message;
    return `refused: ${why.startsWith("needs") ? `a folder to work in ${why}` : why}`;
  }
  const own: WritePolicy | undefined = worksInFolder(parent) ? parent.write : undefined;
  const mode = modeOf(withProjectAutonomy(store, caller));
  const ceiling = own ?? (mode === "plan" ? "read-only" : mode === "manual" ? "ask" : "auto");
  return { cwd, write: strictestWrite(ceiling, req.write ?? own ?? "ask") };
}

/** How much of an answer its card keeps: the whole report, short of a runaway one. */
const REPORT_CHARS = 6000;

const tookMs = (run: RunRecord) =>
  run.ended_at ? Math.max(0, new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) : undefined;

/** The card a delegated run shows once it ended: its state, what it answered and how long it took. */
export function reportCard(p: Extract<Part, { type: "subthread" }>, child: RunRecord, answer: string): Part {
  const ms = tookMs(child);
  return {
    ...p,
    state: child.state,
    summary: answer.slice(0, REPORT_CHARS),
    ...(ms !== undefined ? { ms } : {}),
    ...(child.end_reason ? { end_reason: child.end_reason } : {}),
  };
}

/** A run a limit cut short (its steps or its time): what it gave is a progress report, not a result. */
export const cutShort = (run: Pick<RunRecord, "end_reason">): boolean =>
  run.end_reason === "step_limit" || run.end_reason === "deadline";

/** How a delegated run ended, for its caller: a run that ran out of steps or time did not finish. */
export const endedAs = (run: Pick<RunRecord, "state" | "end_reason">): string =>
  run.end_reason === "step_limit" ? "out_of_steps" : run.end_reason === "deadline" ? "out_of_time" : run.state;

/**
 * Said to the caller beside a delegated answer a limit cut short, so it never reads as the result, with the way to
 * go on in the same session.
 */
export const endNote = (
  run: Pick<RunRecord, "end_reason">,
  how: { session?: string | undefined; continued?: boolean | undefined } = {},
): string => {
  if (!cutShort(run)) return "";
  const what = run.end_reason === "step_limit" ? "steps" : "time";
  const where = how.session ? `with session="${how.session}"` : "in its session";
  const again = how.continued
    ? " APX already continued it once on its own: ask the owner before going on again, unless what is left is small."
    : "";
  return `It ran out of ${what} before finishing: this is a progress report, not its final result. What it says is left is not done; never record it as a verdict.${again} To go on, delegate only the rest ${where} (it keeps its context); to drop it, tell the owner.\n`;
};

/** What a continuation asks the delegate whose turn a limit cut short. */
const continueText = (run: RunRecord) =>
  `APX stopped your last turn on this task before you finished (${run.end_reason === "step_limit" ? "it used all its steps" : (run.error ?? "it ran out of time").replace(/^Could not finish: /, "")}). Go on from where you stopped: do only what is left, without redoing what is done, then give your final answer.`;

/** The calls with an effect APX recorded in a run, and how each ended ("show_widget ok", "message_contact error ×2"). */
export function actionsOf(store: Store, run: RunRecord): string[] {
  const counts = new Map<string, number>();
  for (const s of store.runs.steps(run.id)) {
    if (s.effect === "none" || !["ok", "error", "unknown"].includes(s.state)) continue;
    // A tool name can come from an MCP server: kept to a plain identifier.
    const key = `${s.tool.replace(/[^\w.-]/g, "").slice(0, 60)} ${s.state}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k));
}

/** APX's own account of what a delegated run did, beside the agent's words, so the caller need not check it again. */
export const actionsNote = (actions: readonly string[]) =>
  actions.length
    ? `APX recorded these actions in its run: ${actions.join(", ")}. The ok ones are done; do not check them again.`
    : "APX recorded no action with an effect in its run.";

/** A delegate does its own part and names who owns the rest (it cannot ask them): the caller asks. See DECISIONS.md#d-074 */
export const REDIRECT_NOTE =
  "If it names another agent for what is left, ask that agent yourself: a task it left for them you assign with task_update (that starts their work); anything else, delegate only the remaining part to them.";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "session";

/** A session of `parentId` by the name the caller gave (stored as a slug) or by id. */
export const sessionOf = (store: Store, parentId: string, ref: string): Thread | undefined =>
  store.threads.session(parentId, slug(ref)) ?? store.threads.session(parentId, ref);

/** The caller's card for a delegated run (settled by now), to show again when its result arrives in a new turn. */
export function resultCard(store: Store, childRunId: string): Extract<Part, { type: "subthread" }> | undefined {
  const child = store.runs.get(childRunId);
  const parent = child?.parent_run_id ? store.runs.get(child.parent_run_id) : undefined;
  const msg = parent?.message_id ? store.messages.get(parent.message_id) : undefined;
  return msg?.parts.find(
    (p): p is Extract<Part, { type: "subthread" }> => p.type === "subthread" && p.thread_id === child?.thread_id,
  );
}

export function createDelegations(deps: {
  store: Store;
  kick(threadId: string): void;
  /** Answers still being written, by run. */
  live: Map<string, Display>;
  /** Admits the result as a new input on the caller's thread. */
  deliver(parent: RunRecord, child: RunRecord, answer: string): void;
  /** The engine's end of a run (its waiters, then this module's `childEnded`). */
  ended(run: RunRecord): void;
  /** A delegated run's first deadline in a thread, written to its row until its clock moves it. */
  windowMs(threadId: string): number;
}) {
  const { store } = deps;
  /** Child run → the caller still waiting for it inside its turn. */
  const inline = new Map<string, { caller: string; resolve(run: RunRecord | undefined): void }>();

  function answerOf(run: RunRecord): string {
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    // The last text is the answer; earlier ones are what it said before its tool calls.
    const text = msg?.parts.findLast((p): p is Extract<Part, { type: "text" }> => p.type === "text")?.text;
    return text ?? run.error ?? `(${run.state}, no answer)`;
  }

  /** Updates the sub-thread card in the caller's answer, through its live display when it is still being written. */
  function updateCard(
    parent: RunRecord,
    child: RunRecord,
    next: (p: Extract<Part, { type: "subthread" }>) => Part,
  ): void {
    const match = (p: Part) => p.type === "subthread" && p.thread_id === child.thread_id;
    const card = (p: Part): Part => (p.type === "subthread" ? next(p) : p);
    const display = deps.live.get(parent.id);
    const shown = display?.message.parts.find(match);
    if (display && shown) {
      display.upsert(match, card(shown));
      return;
    }
    const msg = parent.message_id ? store.messages.get(parent.message_id) : undefined;
    const index = msg?.parts.findIndex(match) ?? -1;
    const part = msg?.parts[index];
    if (!msg || !part) return;
    const parts = [...msg.parts];
    parts[index] = card(part);
    store.messages.setPart({ ...msg, parts }, index);
  }

  const settleCard = (parent: RunRecord, child: RunRecord, answer: string) =>
    updateCard(parent, child, (p) => reportCard(p, child, answer));

  /** Tells the owner, once per run, that the breaker holds a queued delegation; going on (or writing) starts it. */
  function holdQueued(parentThreadId: string, run: RunRecord, who: string): void {
    const seen = store.threads.context(parentThreadId).queue_held ?? [];
    if (seen.includes(run.id)) return;
    store.threads.mergeContext(parentThreadId, { queue_held: [...seen.slice(-20), run.id] });
    const notice = heldNotice(store, parentThreadId, who, (run.input?.text ?? "").slice(0, 120), run.agent_id);
    if (notice) store.messages.add({ thread_id: parentThreadId, author: { kind: "system" }, parts: [notice] });
  }

  /**
   * Starts the thread's queued delegations, oldest first, while it has free slots and the breaker lets them; one
   * whose caller is gone is canceled instead. Stopping the caller cancels them on its own (engine `cancel`).
   * Returns how many it started.
   */
  function release(parentThreadId: string): number {
    let started = 0;
    for (const next of store.runs.held(parentThreadId)) {
      if (store.runs.activeDelegations(parentThreadId) >= MAX_ACTIVE_DELEGATIONS) break;
      // Ending one below can release others first.
      if (store.runs.get(next.id)?.state !== "queued") continue;
      const caller = next.parent_run_id ? store.runs.get(next.parent_run_id) : undefined;
      if (!caller || !store.threads.get(parentThreadId)) {
        store.threads.patch(next.thread_id, { state: "canceled" });
        deps.ended(store.runs.setState(next, "canceled", "canceled before it started"));
        continue;
      }
      // Its turn counts against the breaker once it starts, so it is checked again now (DECISIONS.md#d-096).
      const who = store.threads.context(next.thread_id).worker?.name ?? store.agents.get(next.agent_id)?.name ?? "";
      if (tripped(store, parentThreadId)) {
        holdQueued(parentThreadId, next, who);
        break;
      }
      if (agentTripped(store, parentThreadId, next.agent_id, who)) {
        holdQueued(parentThreadId, next, who);
        continue;
      }
      // Its time to work starts now, not when it was queued.
      store.runs.setDeadline(next.id, new Date(Date.now() + deps.windowMs(next.thread_id)).toISOString());
      const run = store.runs.setState(next, "submitted");
      if (store.threads.get(next.thread_id)?.state !== "working")
        store.threads.patch(next.thread_id, { state: "submitted" });
      updateCard(caller, run, (p) => ({ ...p, state: "working" }));
      deps.kick(next.thread_id);
      started++;
    }
    return started;
  }

  /** A free session name under `parentId`, from what the caller asked for (or the agent's name). */
  function sessionName(parentId: string, wanted: string): string {
    const base = slug(wanted);
    for (let n = 1; n < 100; n++) {
      const name = n === 1 ? base : `${base}-${n}`;
      if (!store.threads.session(parentId, name)) return name;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  /** Agents already involved from the top thread down to `threadId`, to refuse A→B→A cycles. */
  function chainAgents(threadId: string): string[] {
    const here = store.threads.get(threadId);
    return [...(here?.agent_ids ?? []), ...ancestors(store, threadId).flatMap((t) => t.agent_ids)];
  }

  /**
   * A delegation the breaker refused: the owner sees why with the ways to go on (a fresh budget or this round
   * released), and going on wakes the caller to ask again. One notice until then, however often it retries.
   */
  function holdDelegation(threadId: string, callerId: string, who: string, task: string): void {
    if (store.threads.context(threadId).kept === callerId) return;
    store.threads.mergeContext(threadId, { kept: callerId });
    const notice = heldNotice(store, threadId, who, task.slice(0, 120));
    if (notice) store.messages.add({ thread_id: threadId, author: { kind: "system" }, parts: [notice] });
  }

  const whoDid = (run: RunRecord) =>
    store.threads.context(run.thread_id).worker?.name ?? store.agents.get(run.agent_id)?.name ?? run.agent_id;

  /**
   * A delegated run a limit cut short, with its caller not waiting for it: the same session goes on once, with its
   * context, unless agents are paused or it was a continuation already. The new run reports to the same caller.
   */
  function continueCut(parent: RunRecord, child: RunRecord): RunRecord | undefined {
    const origin = child.input?.origin;
    if (!cutShort(child) || child.input?.continues || origin?.kind !== "agent") return undefined;
    const sub = store.threads.get(child.thread_id);
    const top = sub?.parent_id;
    if (!sub || !top || !store.threads.get(top)) return undefined;
    if (tripped(store, top) || agentTripped(store, top, child.agent_id, whoDid(child))) return undefined;
    const next = store.runs.create({
      thread_id: sub.id,
      agent_id: child.agent_id,
      trigger: "a2a",
      input: { origin, text: continueText(child), continues: child.id },
      parent_run_id: parent.id,
      depth: child.depth,
      deadline_at: new Date(Date.now() + deps.windowMs(sub.id)).toISOString(),
    });
    store.messages.add({
      thread_id: sub.id,
      author: { kind: "system" },
      parts: [
        {
          type: "notice",
          level: "info",
          code: "delegation.continued",
          text: "APX continued this session after a limit stopped it.",
        },
      ],
    });
    if (store.threads.get(sub.id)?.state !== "working") store.threads.patch(sub.id, { state: "submitted" });
    deps.kick(sub.id);
    return next;
  }

  /**
   * The owner hears that a delegated run hit a limit: which agent, which limit, what it reported so far, and whether
   * APX went on with it or its caller has the report. In the caller's chat (with the session to open or stop), the
   * tray, and their channel.
   */
  function limitNotice(parent: RunRecord, child: RunRecord, answer: string, continued: boolean): void {
    const who = whoDid(child);
    const sub = store.threads.get(child.thread_id);
    const caller = store.agents.get(parent.agent_id)?.name ?? parent.agent_id;
    const limit = child.end_reason === "step_limit" ? "steps" : "time";
    const session = sub?.session ?? child.thread_id;
    const task = (resultCard(store, child.id)?.title ?? sub?.title ?? "").slice(0, 120);
    const sofar = previewOf(answer).slice(0, 200);
    const text = continued
      ? `${who} ran out of ${limit} on “${task}”; APX had it go on once in session ${session}. So far: ${sofar}`
      : `${who} ran out of ${limit} on “${task}”. ${caller} has its report and decides how to go on. So far: ${sofar}`;
    store.messages.add({
      thread_id: parent.thread_id,
      author: { kind: "system" },
      parts: [
        {
          type: "notice",
          level: "warn",
          code: "delegation.limit",
          text,
          vars: {
            variant: `${continued ? "continued" : "returned"}${limit === "steps" ? "Steps" : "Time"}`,
            who,
            task,
            session,
            caller,
            sofar,
            subthread: child.thread_id,
          },
        },
      ],
    });
    store.notifications.add({
      kind: "agent",
      level: "warn",
      title: who,
      body: text,
      thread_id: parent.thread_id,
      ref: child.thread_id,
    });
  }

  return {
    async delegate(from: Caller, req: DelegateTo, task: string, waitMs: number): Promise<string> {
      const parentThread = store.threads.get(from.run.thread_id);
      if (!parentThread) return "refused: the thread is gone";
      if (parentThread.kind === "a2a" || ancestors(store, parentThread.id).length >= MAX_DEPTH)
        return "refused: you are answering another agent, so you do it yourself and ask no one else.";
      // Sessions are stored under a slug of the name the caller gave: look them up the same way (or by id).
      let existing = req.session ? sessionOf(store, parentThread.id, req.session) : undefined;
      const kept = existing ? store.threads.context(existing.id).worker : undefined;
      if (existing && req.worker && !kept)
        return `refused: session "${existing.session ?? existing.id}" is with an agent, not a worker; name a new session.`;
      const worker = kept ?? (existing ? undefined : req.worker);
      if (worker && req.agent) return "refused: give an agent or a worker, not both.";
      // A worker is the caller itself, under the worker's instructions: no self or cycle check applies.
      const toId = worker ? from.agent.id : (existing?.agent_ids[0] ?? req.agent?.id);
      if (existing && req.agent && req.agent.id !== toId)
        return `refused: session "${existing.session ?? existing.id}" is with another agent; leave agent out to continue it, or name a new session.`;
      const to = toId ? store.agents.get(toId) : undefined;
      if (!to)
        return req.session
          ? `refused: no session "${req.session}" in this thread; give an agent to start one (see list_sessions).`
          : "refused: say which agent to ask, or describe a worker.";
      if (!worker && to.id === from.agent.id)
        return "refused: you cannot delegate to yourself; complete this task directly with your own tools.";
      if (!worker && chainAgents(parentThread.id).includes(to.id))
        return `refused: ${to.name} is already part of this delegation chain (cycle).`;
      // A session asked to work in another project, folder or write policy is left as it was, and a new one with the
      // same agent opens there instead of a refusal (DECISIONS.md#d-106).
      let moved: string | undefined;
      if (existing && req.project && existing.project_id !== req.project) {
        moved = existing.session ?? existing.id;
        existing = undefined;
      }
      // The project named, else this chat's, else the agent's own: its folder is where the session reads and works.
      const projectId = existing
        ? existing.project_id
        : (req.project ?? parentThread.project_id ?? (worker ? undefined : to.project_id));
      const place = workspaceOf(store, from.agent, parentThread, projectId, req);
      if (typeof place === "string") return place;
      if (existing && place && (existing.cwd !== place.cwd || existing.write !== place.write)) {
        moved = existing.session ?? existing.id;
        existing = undefined;
      }
      const paused = tripped(store, parentThread.id);
      if (paused) {
        holdDelegation(parentThread.id, from.agent.id, worker?.name ?? to.name, task);
        return `refused: ${paused}. Tell the owner what you were about to delegate; if they let agents go on you get a new turn, and you delegate it again then.`;
      }
      // Past its own budget only this agent waits: the caller picks another or tells the owner (no hold, no notice).
      const spentOwn = agentTripped(store, parentThread.id, to.id, worker?.name ?? to.name);
      if (spentOwn)
        return `refused: ${spentOwn}. Give this work to another agent (list_agents shows what each has left), or tell the owner.`;
      // Past the cap it waits in a durable queue rather than being refused: a refusal was easy to drop. See DECISIONS.md#d-096
      const queued = store.runs.activeDelegations(parentThread.id) >= MAX_ACTIVE_DELEGATIONS;
      deps.live.set(from.run.id, from.display);
      const who = worker?.name ?? to.name;
      const name = existing?.session ?? sessionName(parentThread.id, moved ? who : (req.session ?? who));
      let sub = existing;
      if (!sub) {
        sub = store.threads.create({
          kind: "a2a",
          title: `${from.agent.name} → ${who}: ${task.slice(0, 60)}`,
          agent_ids: worker ? [to.id] : [to.id, from.agent.id],
          project_id: projectId,
          parent_id: parentThread.id,
          session: name,
          ...(place ?? {}),
        });
        if (worker) store.threads.mergeContext(sub.id, { worker });
      }
      store.messages.add({
        thread_id: sub.id,
        author: { kind: "agent", id: from.agent.id },
        parts: [{ type: "text", text: task }],
      });
      const subId = sub.id;
      from.display.upsert((p) => p.type === "subthread" && p.thread_id === subId, {
        type: "subthread",
        thread_id: sub.id,
        agent_id: to.id,
        title: task.slice(0, 120),
        state: queued ? "queued" : "working",
        ...(worker ? { worker: worker.name } : {}),
      });
      const child = store.runs.create({
        thread_id: sub.id,
        agent_id: to.id,
        trigger: "a2a",
        input: {
          origin: {
            kind: "agent",
            id: from.agent.id,
            name: from.agent.name,
            thread_id: parentThread.id,
            run_id: from.run.id,
          },
          text: task,
        },
        parent_run_id: from.run.id,
        depth: from.run.depth + 1,
        deadline_at: new Date(Date.now() + deps.windowMs(sub.id)).toISOString(),
        ...(queued ? { state: "queued" as const } : {}),
      });
      const at = `${
        place
          ? `\nIt works in ${place.cwd}, writes: ${place.write}${req.write && req.write !== place.write ? ` (${req.write} would go further than you may)` : ""}.`
          : ""
      }${moved ? `\nSession "${moved}" works elsewhere, so this is a new session "${name}" without its context: continue it with session="${name}".` : ""}`;
      if (queued) {
        // A session still answering an earlier task keeps showing that it works.
        if (store.threads.get(sub.id)?.state !== "working") store.threads.patch(sub.id, { state: "queued" });
        return `queued: ${MAX_ACTIVE_DELEGATIONS} delegations are running from this thread; ${who} starts this one (session "${name}") when one finishes. Its result comes back like the others: do not delegate it again.${at}`;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = new Promise<RunRecord | undefined>((resolve) => {
        inline.set(child.id, { caller: from.run.id, resolve });
        timer = setTimeout(() => {
          inline.delete(child.id);
          resolve(undefined);
        }, waitMs);
      });
      deps.kick(sub.id);
      const quick = await done;
      clearTimeout(timer);
      inline.delete(child.id);
      const resume = `(session "${name}": delegate with session="${name}" to continue it with ${who}, who keeps the context)`;
      if (quick && TERMINAL.has(quick.state))
        return `${agentReply(who, answerOf(quick), endedAs(quick))}\n${endNote(quick, { session: name, continued: Boolean(quick.input?.continues) })}${actionsNote(actionsOf(store, quick))}\n${REDIRECT_NOTE}\n${resume}${at}`;
      return `${who} keeps working in session "${name}". You will get the result in a new turn: do not wait or ask for its status; tell the owner and go on.${at}`;
    },

    /**
     * A run in a sub-thread ended: a slot may be free, whether or not a delegation started it. A delegated one has
     * its card settled, then its answer goes to the waiting caller or is delivered later.
     */
    childEnded(child: RunRecord): void {
      const from = TERMINAL.has(child.state) ? store.threads.get(child.thread_id)?.parent_id : undefined;
      const parent = child.parent_run_id ? store.runs.get(child.parent_run_id) : undefined;
      if (!parent) {
        if (from) release(from);
        return;
      }
      const waiting = inline.get(child.id);
      // Cut off by APX shutting down: it resumes on the next boot and reports then. A caller still waiting is let go.
      if (!TERMINAL.has(child.state)) {
        inline.delete(child.id);
        waiting?.resolve(child);
        return;
      }
      const answer = answerOf(child);
      // A caller still waiting decides itself; otherwise a run a limit cut short goes on once (DECISIONS.md#d-105).
      const next = waiting ? undefined : continueCut(parent, child);
      if (next) updateCard(parent, child, ({ end_reason: _cut, ...p }) => ({ ...p, state: "working" }));
      else settleCard(parent, child, answer);
      // A caller still waiting tells the owner in the answer it is writing; a later result may reach nobody watching.
      if (!waiting && cutShort(child)) limitNotice(parent, child, answer, Boolean(next));
      if (from) release(from);
      if (waiting) {
        inline.delete(child.id);
        waiting.resolve(child);
        return;
      }
      // A cascade cancel is the owner's decision: it wakes nobody.
      if (!next && child.state !== "canceled") deps.deliver(parent, child, answer);
    },

    release,

    /** The caller's turn ended while it was still waiting: its children report back later as new inputs. */
    callerEnded(callerRunId: string): void {
      // Let go of each wait, so its timer is cleared too.
      for (const [child, w] of inline)
        if (w.caller === callerRunId) {
          inline.delete(child);
          w.resolve(undefined);
        }
    },
  };
}
