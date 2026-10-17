// A model provider's usage limit stops every run that needs it until the limit lifts. Each such run keeps the reset
// time (turn.ts); the owner hears of the stall once, not once per stopped run, whatever stopped how many agents.
import type { RunRecord } from "../domain/runs.ts";

/** When a limit lifts, in the owner's time zone: the time alone today, else the date too. */
export function resetLabel(iso: string, timeZone: string | undefined, now = new Date()): string {
  const at = new Date(iso);
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const time = at.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false });
  return day(at) === day(now) ? time : `${day(at)} ${time}`;
}

/** Runs a provider limit stopped are told as one stall: a new one starts once a model answers or the reset passed. */
export function createStallNotices(deps: { notify(run: RunRecord): void; now?: () => Date }) {
  const clock = deps.now ?? (() => new Date());
  let stall: { until: number | undefined } | undefined;
  return {
    afterRun(run: RunRecord): void {
      // A turn on our own loop answered: the models are back.
      if (run.state === "completed" && (run.harness ?? "native") === "native") stall = undefined;
      if (run.end_reason !== "provider_limit") return;
      if (stall && (stall.until === undefined || clock().getTime() < stall.until)) return;
      stall = { until: run.resets_at ? Date.parse(run.resets_at) : undefined };
      deps.notify(run);
    },
  };
}
