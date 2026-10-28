import type { Routine, RoutineRun } from "@apx/protocol";
import { useEffect, useMemo, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { useNow } from "../common/useNow.ts";
import { routineRuns } from "../data/routines.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { activationSlots } from "./slots.ts";

/** An agent answers (agent), watches (watch) or tells the team news (relay): each has one and can spare a model call. */
export const hasAgent = (a: Routine["action"]) => a === "agent" || a === "watch" || a === "relay" || a === "mail";

/** How one activation ended: it failed, is still running, was skipped (no tokens spent), told the owner, or ran. */
export const barOf = (x: RoutineRun, action: Routine["action"]) => {
  if (x.state === "failed") return "is-failed";
  if (x.state !== "completed" && x.state !== "canceled") return "is-live";
  // A message or a shell job never calls a model: it ran when it sent or ran its command.
  const skipped = hasAgent(action) ? x.model_called === false : action === "message" && !x.delivered;
  if (skipped) return "is-skipped";
  return x.delivered ? "is-told" : "is-ran";
};

const BAR_KEY: Record<ReturnType<typeof barOf>, MessageKey> = {
  "is-failed": "routines.legend.failed",
  "is-skipped": "routines.legend.skipped",
  "is-told": "routines.legend.told",
  "is-ran": "routines.legend.ran",
  "is-live": "routines.running",
};
export const barKey = (x: RoutineRun, action: Routine["action"]): MessageKey => BAR_KEY[barOf(x, action)];

/** A routine's recent runs, read again whenever its latest run starts or ends. */
export function useRuns(r: Routine) {
  const [runs, setRuns] = useState<RoutineRun[]>();
  const latest = `${r.last?.run_id}:${r.last?.state}:${r.last?.delivered}`;
  useEffect(() => {
    let live = true;
    void routineRuns(r.id).then((list) => live && latest && setRuns(list));
    return () => {
      live = false;
    };
  }, [r.id, latest]);
  return runs;
}

/** A full row of bars: one per expected activation (gray when it did not run), colored by how each one ended. */
export function ActivationBars({
  routine: r,
  runs,
  large,
}: {
  routine: Routine;
  runs?: RoutineRun[];
  large?: boolean;
}) {
  const t = useT();
  // Minutes are enough: a new slot opens at most every five.
  const now = useNow(true, 60_000);
  const slots = useMemo(
    () => activationSlots(r.schedule, runs ?? [], new Date(now), r.next_run_at),
    [r.schedule, r.next_run_at, runs, now],
  );
  return (
    <span className={large ? "rtbars is-large" : "rtbars"} role="img" aria-label={t("routines.col.activations")}>
      {slots.map((s, i) => (
        <span
          // Slots are positions in a fixed row; their order never changes.
          // biome-ignore lint/suspicious/noArrayIndexKey: positional
          key={i}
          className={`rtbar ${s.run ? barOf(s.run, r.action) : "is-none"}`}
          title={
            s.run
              ? `${shortWhen(s.run.started_at)} · ${t(barKey(s.run, r.action))}`
              : s.at
                ? `${shortWhen(s.at)} · ${t("routines.legend.none")}`
                : t("routines.legend.none")
          }
        />
      ))}
    </span>
  );
}
