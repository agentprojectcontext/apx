// A model provider's usage limit stops every run that needs it until the limit lifts. Each such run keeps the reset
// time (turn.ts); the owner hears of the stall once, not once per stopped run, whatever stopped how many agents.
// A run that answered says nothing about it: another agent may be on another provider.
import type { RunRecord } from "../domain/runs.ts";

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
