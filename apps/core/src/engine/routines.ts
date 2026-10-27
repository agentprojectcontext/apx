// The scheduler. Every tick it reserves each due routine (next time and a lease) before starting it, so a crash or a
// slow run never makes a routine run twice; a missed time (the core was off) runs once when it comes back. Each run
// gets a conversation of its own. The owner hears back only when the agent has something to say; a quiet run's
// conversation is archived.
import type { Routine, RoutineRun } from "@apx/protocol";
import { type FlowRoutineEvent, type RunRecord, TERMINAL } from "../domain/runs.ts";
import { MIN_GAP_MIN, nextRun } from "../domain/schedule.ts";
import type { Store } from "../domain/store.ts";
import { previewOf } from "../domain/threads.ts";
import { conflict, errorMessage, notFound } from "../errors.ts";
import type { Log } from "../log.ts";
import type { AdmitFn } from "./engine.ts";

const TICK_MS = 15_000;
/** How long a started run holds its routine; longer than any run, and a crashed core's hold expires by itself. */
const LEASE_MS = 60 * 60_000;
/** The answer that means "nothing to tell the owner this time". */
export const SKIP_ANSWER = "SKIP";

/** "SKIP", "**SKIP**", "`skip`." all mean the agent had nothing to say. */
export const isSkip = (text: string): boolean => text.replace(/[.\s*_`~"'!]/g, "").toUpperCase() === SKIP_ANSWER;

export type RoutineDelivery = (r: { routine: Routine; run: RecordedRun; text: string; failed: boolean }) => void;
type RecordedRun = Pick<RunRecord, "id" | "thread_id" | "state">;

/** When a schedule runs next after `from`: after a run, never sooner than the minimum gap from it. */
export function nextTime(r: Pick<Routine, "schedule">, from: Date, lastRun?: Date): string | undefined {
  const floor = lastRun ? Math.max(from.getTime(), lastRun.getTime() + (MIN_GAP_MIN - 1) * 60_000) : from.getTime();
  const next = nextRun(r.schedule, r.schedule.kind === "cron" ? new Date(floor) : from, lastRun);
  return next && next.getTime() > from.getTime() ? next.toISOString() : undefined;
}

export function createScheduler(deps: {
  store: Store;
  admit: AdmitFn;
  deliver: RoutineDelivery;
  log: Log;
  now?: () => Date;
  /** Other work on the same clock (due reminders). */
  eachTick?: (at: Date) => void;
}) {
  const { store, log } = deps;
  const clock = deps.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;

  /** Reserves the routine and starts its run in a new conversation. */
  function start(r: Routine, at: Date, next: string | undefined, event?: FlowRoutineEvent): RoutineRun {
    return store.tx(() => {
      store.routines.claim(r.id, {
        next_run_at: next,
        lease_until: new Date(at.getTime() + LEASE_MS).toISOString(),
        at: at.toISOString(),
      });
      if (!store.agents.get(r.agent_id)) throw notFound(`agent ${r.agent_id}`);
      const when = at.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
      const thread = store.threads.create({
        kind: "routine",
        title: `${r.name} · ${when}`,
        agent_ids: [r.agent_id],
        project_id: r.project_id,
      });
      // The prompt is the owner's own words, written when they set the routine up.
      store.messages.add({ thread_id: thread.id, author: { kind: "user" }, parts: [{ type: "text", text: r.prompt }] });
      store.threads.patch(thread.id, { preview: previewOf(r.prompt) });
      const run = deps.admit({
        thread_id: thread.id,
        agent_id: r.agent_id,
        trigger: "routine",
        origin: { kind: "routine", id: r.id, name: r.name, ...(event ? { event } : {}) },
        text: r.prompt,
      });
      store.routines.addRun({ routine_id: r.id, run_id: run.id, thread_id: thread.id });
      return { run_id: run.id, thread_id: thread.id, state: run.state, started_at: run.started_at };
    });
  }

  function tick(): void {
    const at = clock();
    try {
      deps.eachTick?.(at);
    } catch (err) {
      log.warn({ err: errorMessage(err, 200) }, "tick work failed");
    }
    for (const r of store.routines.due(at.toISOString())) {
      // A run that outlived its lease (it waited long for the owner) still holds the routine.
      const last = store.routines.get(r.id)?.last;
      if (last && !TERMINAL.has(last.state)) continue;
      const next = nextTime(r, at, at);
      try {
        start(r, at, next);
      } catch (err) {
        // The time is spent either way: a broken routine must not be retried every tick.
        store.routines.claim(r.id, { next_run_at: next, lease_until: at.toISOString(), at: at.toISOString() });
        log.warn({ routine: r.id, err: errorMessage(err, 200) }, "routine not started");
      }
    }
  }

  return {
    start() {
      tick();
      timer = setInterval(tick, TICK_MS);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
    },
    tick,
    /** When a schedule would run next from now (the scheduler's now). */
    nextFor: (schedule: Routine["schedule"]) => nextTime({ schedule }, clock()),
    /** Runs a routine now, outside its schedule; its next scheduled time stays as it was. */
    runNow(id: string, event?: FlowRoutineEvent): RoutineRun {
      const r = store.routines.get(id);
      if (!r) throw notFound(`routine ${id}`);
      if (r.last && !TERMINAL.has(r.last.state)) throw conflict(`${r.name} is running already`);
      return start(r, clock(), r.next_run_at, event);
    },
    /** A run ended: free the routine, and tell the owner unless the agent had nothing to say. */
    afterRun(run: RunRecord): void {
      if (run.trigger !== "routine") return;
      const id = store.routines.ofRun(run.id);
      if (!id) return;
      store.routines.release(id);
      const routine = store.routines.get(id);
      if (!routine) return;
      const msg = run.message_id ? store.messages.get(run.message_id) : undefined;
      const text = (msg?.parts ?? [])
        .map((p) => (p.type === "text" ? p.text : ""))
        .join("\n")
        .trim();
      const failed = run.state === "failed";
      const quiet = run.state === "canceled" || (!failed && (!text || isSkip(text)));
      // A provider limit is told once per stall (provider-limit.ts), not by each routine it stopped.
      const stalled = run.end_reason === "provider_limit";
      store.routines.delivered(run.id, !quiet && !stalled);
      if (stalled) return;
      if (quiet) {
        // Nothing said: the run stays reachable from its routine, out of the Inbox and its unread count.
        store.threads.patch(run.thread_id, { unread: 0 }, false);
        store.threads.arrange(run.thread_id, { archived: true });
        return;
      }
      deps.deliver({ routine, run, text: failed ? (run.error ?? "") : text, failed });
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
