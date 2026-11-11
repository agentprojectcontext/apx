import type { Routine, RoutineRun } from "@apx/protocol";
import { Button, Icons, Tooltip } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { dayLabel } from "../common/format.ts";
import { useT } from "../i18n/index.ts";
import { railWindow } from "./railWindow.ts";
import { outcomeMarks, toneOf } from "./runOutcome.ts";

/**
 * A slim timeline on the chat's edge: one mark per run, coloured by how it ended; a mark scrolls to its run. With more
 * runs than fit, it shows those around the open one and says how many come before and after.
 */
export function RunRail({
  runs,
  action,
  active,
  onJump,
}: {
  runs: RoutineRun[];
  action: Routine["action"];
  active: number;
  onJump: (index: number) => void;
}) {
  const t = useT();
  const rail = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setHeight(el.clientHeight - 12));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  if (runs.length < 2) return null;
  const { from, to } = height > 0 ? railWindow(runs.length, active, height) : { from: 0, to: runs.length };
  const before = from;
  const after = runs.length - to;
  return (
    <nav ref={rail} className="rtchat__rail" aria-label={t("routineChat.timeline")}>
      <div className="rtchat__railtrack">
        {before > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="rtchat__more"
            title={t("routineChat.earlierRuns", { n: before })}
            leadingIcon={<Icons.ChevronUp size={12} />}
            onClick={() => onJump(from - 1)}
          >
            {before}
          </Button>
        )}
        {runs.slice(from, to).map((run, k) => {
          const i = from + k;
          const label = `${dayLabel(run.started_at)} · ${outcomeMarks(run, action)
            .map((m) => t(m.key))
            .join(" · ")}`;
          return (
            <Tooltip key={run.run_id} content={label} side="left">
              <Button
                variant="ghost"
                size="sm"
                aria-label={label}
                aria-current={i === active ? "step" : undefined}
                className={`rtchat__dot is-${toneOf(run, action)}${i === active ? " is-active" : ""}`}
                onClick={() => onJump(i)}
              />
            </Tooltip>
          );
        })}
        {after > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="rtchat__more"
            title={t("routineChat.laterRuns", { n: after })}
            leadingIcon={<Icons.ChevronDown size={12} />}
            onClick={() => onJump(to)}
          >
            {after}
          </Button>
        )}
      </div>
    </nav>
  );
}
