// Teammates asked in one turn answer the caller together: each answer is held until the others are in or the hold
// runs out, kept on the caller's chat so a restart keeps it. A single delegation is not held. See DECISIONS.md#d-194
import { type RunRecord, TERMINAL } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import type { FanoutGroup } from "../domain/threads.ts";
import { fromTeam } from "../tools/result.ts";
import { keepWhilePaused } from "./breaker.ts";
import { actionsNote, delegationResult, endedAs, endNote, resultOf } from "./delegation.ts";
import type { AdmitFn, RunTimers } from "./engine.ts";
import { laterReplyTo } from "./home-channel.ts";
import { outcomeNote } from "./run-outcome.ts";

/** A delegated run that ended, and why APX stopped going on with it (a limit cut it short), if it did. */
export type Held = { child: RunRecord; stopped?: string | undefined };

/** The most of each answer a combined turn carries: the whole report, short of a runaway one (as its card). */
const ANSWER_CHARS = 6000;

/**
 * Wakes the caller with what its delegations answered: one result as before, or several in one turn, each in its own
 * envelope. Paused, each is kept for its next turn instead, and the owner sees why.
 */
export function deliverResults(store: Store, admit: AdmitFn, parent: RunRecord, results: readonly Held[]): void {
  const told = results.map(({ child, stopped }) => {
    const { answer, outcome } = resultOf(store, child);
    return { child, answer, result: delegationResult(store, child, stopped, outcome) };
  });
  // The pause is the chat's: all of them are kept, or none.
  const kept = told.map(({ child, answer, result }) =>
    keepWhilePaused(store, {
      thread_id: parent.thread_id,
      agent_id: parent.agent_id,
      who: result.name,
      run_id: child.id,
      note: `A task you delegated to ${result.name} ended (${endedAs(child)}) while agents were paused:\n${fromTeam("delegation_result", { from: result.name }, answer.slice(0, 4000))}\n${endNote(child, result)}${result.outcome ? outcomeNote(result.outcome) : ""}${actionsNote(result.actions ?? [])}`,
    }),
  );
  const [one] = told;
  if (!one || kept[0]) return;
  admit({
    thread_id: parent.thread_id,
    agent_id: parent.agent_id,
    trigger: "a2a_result",
    origin:
      told.length === 1
        ? { kind: "delegation_result", ...one.result }
        : {
            kind: "delegation_results",
            results: told.map((t) => ({ ...t.result, answer: t.answer.slice(0, ANSWER_CHARS) })),
          },
    text: told.length === 1 ? one.answer : `${told.map((t) => t.result.name).join(", ")} answered.`,
    depth: parent.depth,
    reply_to: laterReplyTo(store, parent.thread_id, parent.input?.reply_to),
  });
}

export function createFanout(deps: {
  store: Store;
  timers: RunTimers;
  holdMs: number;
  /** Whether the engine is still running this run: its row may say it ended before the engine heard of its end. */
  running(runId: string): boolean;
  deliver(parent: RunRecord, results: Held[]): void;
  /** Shows on a card that its answer waits for the others (how many are in), or no longer does. */
  mark(parent: RunRecord, child: RunRecord, held?: { got: number; of: number }): void;
}) {
  const { store } = deps;
  /** Hold timers by the asking run. */
  const armed = new Map<string, () => void>();

  const groupsOf = (threadId: string): FanoutGroup[] => store.threads.context(threadId).fanout ?? [];
  const save = (threadId: string, groups: FanoutGroup[]) =>
    store.threads.mergeContext(threadId, { fanout: groups.length ? groups : undefined });
  const without = (threadId: string, runId: string) => groupsOf(threadId).filter((g) => g.run !== runId);

  /** The caller's other delegations still to answer: queued, at work or waiting on the owner. */
  const atWork = (parent: RunRecord, except?: string): RunRecord[] =>
    store.runs
      .children(parent.id)
      .filter(
        (r) =>
          r.id !== except &&
          r.trigger === "a2a" &&
          (!TERMINAL.has(r.state) || deps.running(r.id)) &&
          store.threads.get(r.thread_id)?.parent_id === parent.thread_id,
      );

  /** Held runs in the order the caller asked for them: its cards' order (a restart resumes them in any order). */
  function heldRuns(parent: RunRecord, held: FanoutGroup["held"]): Held[] {
    const order = store.messages
      .ofRun(parent.thread_id, parent.id)
      .flatMap((m) => m.parts.flatMap((p) => (p.type === "subthread" ? [p.thread_id] : [])));
    return held
      .flatMap((h) => {
        const child = store.runs.get(h.child);
        return child ? [{ child, stopped: h.stopped }] : [];
      })
      .sort((a, b) => order.indexOf(a.child.thread_id) - order.indexOf(b.child.thread_id));
  }

  function show(parent: RunRecord, held: Held[], of?: number): void {
    for (const h of held) deps.mark(parent, h.child, of ? { got: held.length, of } : undefined);
  }

  function disarm(runId: string): void {
    armed.get(runId)?.();
    armed.delete(runId);
  }

  function arm(threadId: string, runId: string, until: string): void {
    disarm(runId);
    const ms = Math.max(0, new Date(until).getTime() - deps.timers.now());
    armed.set(
      runId,
      deps.timers.after(ms, () => expire(threadId, runId)),
    );
  }

  /** Lets the group go: what it held is delivered (unless dropped), and its cards no longer say they wait. */
  function release(parent: RunRecord, group: FanoutGroup, deliver: boolean, ending?: string): void {
    disarm(group.run);
    const held = heldRuns(parent, group.held);
    // Past the hold, a group with answers still out stays closed so they come one by one, as before.
    const closed = deliver && atWork(parent, ending).length > 0;
    save(parent.thread_id, [
      ...without(parent.thread_id, group.run),
      ...(closed ? [{ run: group.run, until: group.until, held: [], closed: true }] : []),
    ]);
    show(parent, held);
    if (deliver && held.length) deps.deliver(parent, held);
  }

  function expire(threadId: string, runId: string): void {
    armed.delete(runId);
    const group = groupsOf(threadId).find((g) => g.run === runId);
    const parent = store.runs.get(runId);
    if (!group || group.closed) return;
    if (!parent) save(threadId, without(threadId, runId));
    else release(parent, group, true);
  }

  return {
    /** A delegated run ended with an answer for its caller: held while others asked with it are out, else delivered. */
    arrive(parent: RunRecord, child: RunRecord, stopped?: string): void {
      const group = groupsOf(parent.thread_id).find((g) => g.run === parent.id);
      const others = atWork(parent, child.id);
      if (!group || group.closed) {
        if (group && !others.length) save(parent.thread_id, without(parent.thread_id, parent.id));
        if (group || !others.length) {
          deps.deliver(parent, [{ child, stopped }]);
          return;
        }
      }
      const held = [...(group?.held ?? []), { child: child.id, ...(stopped ? { stopped } : {}) }];
      const until = group?.until ?? new Date(deps.timers.now() + deps.holdMs).toISOString();
      const next: FanoutGroup = { run: parent.id, until, held };
      if (!others.length) {
        release(parent, next, true, child.id);
        return;
      }
      save(parent.thread_id, [...without(parent.thread_id, parent.id), next]);
      if (!armed.has(parent.id)) arm(parent.thread_id, parent.id, until);
      show(parent, heldRuns(parent, held), held.length + others.length);
    },

    /**
     * Any run ended: when it was one a group waited on and gave no answer to deliver (canceled, taken inside the
     * caller's turn), the group goes once nothing else is out, or shows the new count.
     */
    settle(run: RunRecord): void {
      if (!TERMINAL.has(run.state) || !run.parent_run_id) return;
      const parent = store.runs.get(run.parent_run_id);
      const group = parent ? groupsOf(parent.thread_id).find((g) => g.run === parent.id) : undefined;
      if (!parent || !group) return;
      const others = atWork(parent, run.id).length;
      if (group.closed) {
        if (!others) save(parent.thread_id, without(parent.thread_id, parent.id));
        return;
      }
      if (!others) release(parent, group, true, run.id);
      else show(parent, heldRuns(parent, group.held), group.held.length + others);
    },

    /** The owner stopped the chat: what its groups held wakes nobody (each answer stays on its card). */
    drop(threadId: string): void {
      const groups = groupsOf(threadId);
      if (!groups.length) return;
      for (const group of groups) {
        const parent = store.runs.get(group.run);
        if (parent) release(parent, group, false);
        else disarm(group.run);
      }
      save(threadId, []);
    },

    /** Boot: each group held across the restart waits for the rest of its hold. */
    restore(): void {
      for (const threadId of store.threads.withFanout())
        for (const group of groupsOf(threadId)) if (!group.closed) arm(threadId, group.run, group.until);
    },

    stop(): void {
      for (const runId of [...armed.keys()]) disarm(runId);
    },
  };
}
