// The one way an agent asks another: a sub-thread with a durable child run. The caller may wait for it inside its
// turn; past that (or when the caller's turn ends for any reason) the result comes back to the caller's thread as
// a new input. See DECISIONS.md#d-009
import type { Part, RunState } from "@apx/protocol";
import type { AgentRecord } from "../domain/agents.ts";
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { agentReply } from "../tools/agents.ts";
import type { Display } from "./display.ts";

export const A2A_DEADLINE_MS = 10 * 60_000;
export const MAX_ACTIVE_DELEGATIONS = 3;

export type Caller = { run: RunRecord; agent: AgentRecord; display: Display };

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
  const inline = new Map<string, { caller: string; resolve(run: RunRecord): void }>();

  function answerOf(run: RunRecord): string {
    const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
    const text = msg?.parts.find((p): p is Extract<Part, { type: "text" }> => p.type === "text")?.text;
    return text ?? run.error ?? `(${run.state}, no answer)`;
  }

  /** Updates the sub-thread card in the caller's answer, through its live display when it is still being written. */
  function settleCard(parent: RunRecord, child: RunRecord, answer: string): void {
    const match = (p: Part) => p.type === "subthread" && p.thread_id === child.thread_id;
    const card =
      (state: RunState) =>
      (p: Part): Part =>
        p.type === "subthread" ? { ...p, state, summary: answer.slice(0, 240) } : p;
    const display = deps.live.get(parent.id);
    const shown = display?.message.parts.find(match);
    if (display && shown) return display.upsert(match, card(child.state)(shown));
    const msg = parent.message_id ? store.messages.get(parent.message_id) : undefined;
    const index = msg?.parts.findIndex(match) ?? -1;
    const part = msg?.parts[index];
    if (!msg || !part) return;
    const parts = [...msg.parts];
    parts[index] = card(child.state)(part);
    store.messages.setPart({ ...msg, parts }, index);
  }

  /** Agents already involved from the top thread down to `threadId`, to refuse A→B→A cycles. */
  function chainAgents(threadId: string): string[] {
    const ids: string[] = [];
    let t = store.threads.get(threadId);
    for (let hops = 0; t && hops < 10; hops++) {
      ids.push(...t.agent_ids);
      t = t.parent_id ? store.threads.get(t.parent_id) : undefined;
    }
    return ids;
  }

  return {
    async delegate(from: Caller, to: AgentRecord, task: string, waitMs: number): Promise<string> {
      const parentThread = store.threads.get(from.run.thread_id);
      if (!parentThread) return "refused: the thread is gone";
      if (chainAgents(parentThread.id).includes(to.id))
        return `refused: ${to.name} is already part of this delegation chain (cycle).`;
      if (store.runs.activeDelegations(parentThread.id) >= MAX_ACTIVE_DELEGATIONS)
        return `refused: ${MAX_ACTIVE_DELEGATIONS} delegations are already running from this thread; wait for their results.`;
      deps.live.set(from.run.id, from.display);
      const sub = store.threads.create({
        kind: "a2a",
        title: `${from.agent.name} → ${to.name}: ${task.slice(0, 60)}`,
        agent_ids: [to.id, from.agent.id],
        project_id: parentThread.project_id,
        parent_id: parentThread.id,
      });
      store.messages.add({
        thread_id: sub.id,
        author: { kind: "agent", id: from.agent.id },
        parts: [{ type: "text", text: task }],
      });
      from.display.upsert((p) => p.type === "subthread" && p.thread_id === sub.id, {
        type: "subthread",
        thread_id: sub.id,
        agent_id: to.id,
        title: task.slice(0, 120),
        state: "working",
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
        timer = setTimeout(() => resolve(undefined), waitMs);
      });
      deps.kick(sub.id);
      const quick = await done;
      clearTimeout(timer);
      inline.delete(child.id);
      if (quick) return agentReply(to.name, answerOf(quick), quick.state);
      return `${to.name} keeps working in a sub-thread. You will get the result in a new turn: do not wait or ask for its status; tell the owner and go on.`;
    },

    /** A delegated run ended: settle its card, then hand the answer to the waiting caller or deliver it later. */
    childEnded(child: RunRecord): void {
      if (!child.parent_run_id) return;
      const parent = store.runs.get(child.parent_run_id);
      if (!parent) return;
      const answer = answerOf(child);
      settleCard(parent, child, answer);
      const waiting = inline.get(child.id);
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
      for (const [child, w] of inline) if (w.caller === callerRunId) inline.delete(child);
    },
  };
}
