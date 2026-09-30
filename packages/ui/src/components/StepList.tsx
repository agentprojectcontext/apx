import type { ReactNode } from "react";
import { cx } from "../cx";
import { StatusIcon, type StepStatus } from "./StatusIcon";

export interface Step {
  /** Bold source/subject: "CRM", "Sequencer". */
  label: ReactNode;
  /** What happened: "list pulled · 52 accounts". */
  detail?: ReactNode;
  status?: StepStatus;
}

export interface StepListProps {
  steps: Step[];
  /** Separator between label and detail. */
  arrow?: ReactNode;
  className?: string;
}

/** Compact run report inside a message: one line per integration/step with its status. */
export function StepList({ steps, arrow = "→", className }: StepListProps) {
  return (
    <ul className={cx("apx-steps", className)}>
      {steps.map((s, i) => (
        <li key={i} className={cx("apx-steps__row", `is-${s.status ?? "done"}`)}>
          <StatusIcon status={s.status ?? "done"} />
          <span>
            <strong className="apx-steps__label">{s.label}</strong>
            {s.detail && (
              <>
                <span className="apx-steps__arrow"> {arrow} </span>
                <span className="apx-steps__detail">{s.detail}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
