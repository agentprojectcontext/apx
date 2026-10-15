// The one way an agent asks another: a sub-thread with a durable child run. The caller may wait for it inside its
// turn; past that (or when the caller's turn ends for any reason) the result comes back to the caller's thread as
// a new input. See DECISIONS.md#d-009
import type { Part } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { Worker } from "../domain/threads.ts";
import { agentReply } from "../tools/agents.ts";
import { ancestors } from "./ancestry.ts";
import { agentTripped, heldNotice, tripped } from "./breaker.ts";
import type { Display } from "./display.ts";
import { A2A_DEADLINE_MS, MAX_ACTIVE_DELEGATIONS, MAX_DEPTH } from "./limits.ts";

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
};

/** How much of an answer its card keeps: the whole report, short of a runaway one. */
const REPORT_CHARS = 6000;

const tookMs = (run: RunRecord) =>
  run.ended_at ? Math.max(0, new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) : undefined;

/** The card a delegated run shows once it ended: its state, what it answered and how long it took. */
export function reportCard(p: Extract<Part, { type: "subthread" }>, child: RunRecord, answer: string): Part {
  const ms = tookMs(child);
  return { ...p, state: child.state, summary: answer.slice(0, REPORT_CHARS), ...(ms !== undefined ? { ms } : {}) };
}

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
  function settleCard(parent: RunRecord, child: RunRecord, answer: string): void {
    const match = (p: Part) => p.type === "subthread" && p.thread_id === child.thread_id;
    const card = (p: Part): Part => (p.type === "subthread" ? reportCard(p, child, answer) : p);
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

  return {
    async delegate(from: Caller, req: DelegateTo, task: string, waitMs: number): Promise<string> {
      const parentThread = store.threads.get(from.run.thread_id);
      if (!parentThread) return "refused: the thread is gone";
      if (parentThread.kind === "a2a" || ancestors(store, parentThread.id).length >= MAX_DEPTH)
        return "refused: you are answering another agent, so you do it yourself and ask no one else.";
      // Sessions are stored under a slug of the name the caller gave: look them up the same way (or by id).
      const existing = req.session
        ? (store.threads.session(parentThread.id, slug(req.session)) ??
          store.threads.session(parentThread.id, req.session))
        : undefined;
      const kept = existing ? store.threads.context(existing.id).worker : undefined;
      if (existing && req.worker && !kept)
        return `refused: session "${existing.session ?? existing.id}" is with an agent, not a worker; name a new session.`;
      const worker = kept ?? (existing ? undefined : req.worker);
      if (worker && req.agent) return "refused: give an agent or a worker, not both.";
      // A worker is the caller itself, under the worker's instructions: no self or cycle check applies.
      const toId = worker ? from.agent.id : (existing?.agent_ids[0] ?? req.agent?.id);
      if (existing && req.project && existing.project_id !== req.project)
        return `refused: session "${existing.session ?? existing.id}" works in another project; name a new session.`;
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
      const paused = tripped(store, parentThread.id);
      if (paused) {
        holdDelegation(parentThread.id, from.agent.id, worker?.name ?? to.name, task);
        return `refused: ${paused}. Tell the owner what you were about to delegate; if they let agents go on you get a new turn, and you delegate it again then.`;
      }
      // Past its own budget only this agent waits: the caller picks another or tells the owner (no hold, no notice).
      const spentOwn = agentTripped(store, parentThread.id, to.id, worker?.name ?? to.name);
      if (spentOwn)
        return `refused: ${spentOwn}. Give this work to another agent (list_agents shows what each has left), or tell the owner.`;
      if (store.runs.activeDelegations(parentThread.id) >= MAX_ACTIVE_DELEGATIONS)
        return `refused: ${MAX_ACTIVE_DELEGATIONS} delegations are already running from this thread; wait for their results.`;
      deps.live.set(from.run.id, from.display);
      const who = worker?.name ?? to.name;
      const name = existing?.session ?? sessionName(parentThread.id, req.session ?? who);
      let sub = existing;
      if (!sub) {
        sub = store.threads.create({
          kind: "a2a",
          title: `${from.agent.name} → ${who}: ${task.slice(0, 60)}`,
          agent_ids: worker ? [to.id] : [to.id, from.agent.id],
          // The project named, else this chat's, else the agent's own: its folder is where the session reads and works.
          project_id: req.project ?? parentThread.project_id ?? (worker ? undefined : to.project_id),
          parent_id: parentThread.id,
          session: name,
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
        state: "working",
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
        deadline_at: new Date(Date.now() + A2A_DEADLINE_MS).toISOString(),
      });
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
        return `${agentReply(who, answerOf(quick), quick.state)}\n${actionsNote(actionsOf(store, quick))}\n${REDIRECT_NOTE}\n${resume}`;
      return `${who} keeps working in session "${name}". You will get the result in a new turn: do not wait or ask for its status; tell the owner and go on.`;
    },

    /** A delegated run ended: settle its card, then hand the answer to the waiting caller or deliver it later. */
    childEnded(child: RunRecord): void {
      if (!child.parent_run_id) return;
      const parent = store.runs.get(child.parent_run_id);
      if (!parent) return;
      const waiting = inline.get(child.id);
      // Cut off by APX shutting down: it resumes on the next boot and reports then. A caller still waiting is let go.
      if (!TERMINAL.has(child.state)) {
        inline.delete(child.id);
        waiting?.resolve(child);
        return;
      }
      const answer = answerOf(child);
      settleCard(parent, child, answer);
      if (waiting) {
        inline.delete(child.id);
        waiting.resolve(child);
        return;
      }
      // A cascade cancel is the owner's decision: it wakes nobody.
      if (child.state !== "canceled") deps.deliver(parent, child, answer);
    },

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
