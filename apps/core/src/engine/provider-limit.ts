// A model provider's usage limit stops every run that needs it until the limit lifts. Each such run keeps the reset
// time (turn.ts); the owner hears of the stall once, not once per stopped run, whatever stopped how many agents.
// A run that answered says nothing about it: another agent may be on another provider. Once the limit lifts, the
// stopped turns are picked back up (`resumeLimited`), on the office clock.
import type { RunRecord } from "../domain/runs.ts";
import type { Store } from "../domain/store.ts";
import { agentTrip, trip } from "./breaker.ts";
import type { AdmitFn } from "./engine.ts";

/** When a limit lifts, in the owner's time zone: the time alone today, else the date too. */
export function resetLabel(iso: string, timeZone: string | undefined, now = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const time = at.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  return day(at) === day(now) ? time : `${day(at)} ${time}`;
}

/** A stall whose provider did not say when it lifts is told again after this long. */
const UNSAID_STALL_MS = 3600_000;

/** Runs a provider limit stopped are told as one stall: a new one starts once its reset passed. */
export function createStallNotices(deps: { notify(run: RunRecord): void; now?: () => Date }) {
  const clock = deps.now ?? (() => new Date());
  let until = 0;
  return {
    afterRun(run: RunRecord): void {
      if (run.end_reason !== "provider_limit") return;
      const now = clock().getTime();
      if (now < until) return;
      until = run.resets_at ? Date.parse(run.resets_at) : now + UNSAID_STALL_MS;
      deps.notify(run);
    },
  };
}

/** What the model reads when its turn is picked back up after the limit that stopped it lifted. */
export const LIMIT_RESUME_NOTE =
  "Your model provider's usage limit stopped this turn; it has lifted now. Carry on from where it stopped and finish the task. Tools marked effect UNKNOWN may have acted: check before running them again.";

/** How often stopped work is looked for: the office clock beats every minute. */
export const LIMIT_RESUME_EVERY_MS = 60_000;
/** Past the reset by this much, so the provider's clock has passed it too. */
const RESET_GRACE_MS = 30_000;
/** Work stopped longer ago than this stays for the owner: picking it up now would surprise them. */
const RESUME_WITHIN_MS = 24 * 3600_000;
/** A turn stopped again and again is left for the owner after this many resumes. */
const MAX_RESUMES = 3;

const resumesBefore = (store: Store, run: RunRecord): number => {
  let n = 0;
  for (let r = run; r.input?.resume_of && n <= MAX_RESUMES; n++) {
    const prev = store.runs.get(r.input.resume_of);
    if (prev?.end_reason !== "provider_limit") break;
    r = prev;
  }
  return n;
};

/**
 * Turns a provider's usage limit stopped are picked back up once it lifts (or, unsaid, an hour later), in the same
 * chat with what they had done. Only the chat's last turn, never a routine's (its next run comes on schedule) nor a
 * delegation's (its caller already heard how it ended), and not while agents are paused. Returns how many it started.
 */
export function resumeLimited(store: Store, admit: AdmitFn, at: Date): number {
  const now = at.getTime();
  let started = 0;
  for (const run of store.runs.limitStopped(new Date(now - RESUME_WITHIN_MS).toISOString())) {
    if (!run.input || run.trigger === "routine" || run.parent_run_id || !run.ended_at) continue;
    const due = run.resets_at ? Date.parse(run.resets_at) + RESET_GRACE_MS : Date.parse(run.ended_at) + UNSAID_STALL_MS;
    if (now < due) continue;
    // The owner wrote again, or it was already picked up: that turn is the one that goes on.
    if (store.runs.list(run.thread_id, 1)[0]?.id !== run.id) continue;
    if (!store.threads.get(run.thread_id) || !store.agents.get(run.agent_id)) continue;
    if (trip(store, run.thread_id) || agentTrip(store, run.thread_id, run.agent_id)) continue;
    if (resumesBefore(store, run) >= MAX_RESUMES) continue;
    admit({
      thread_id: run.thread_id,
      agent_id: run.agent_id,
      trigger: run.trigger,
      origin: run.input.origin,
      text: run.input.text,
      ...(run.input.attachments ? { attachments: run.input.attachments } : {}),
      reply_to: run.input.reply_to ?? null,
      depth: run.depth,
      resume_of: run.id,
    });
    started++;
  }
  return started;
}
