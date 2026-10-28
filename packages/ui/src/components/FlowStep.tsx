import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";

export type FlowStepTone = "brand" | "violet" | "info" | "warning" | "neutral";
export type FlowStepState = "ran" | "skipped" | "failed" | "live";

export interface FlowStepProps {
  /** The step's kind as a tile ("Webhook", "Condition"), toned by family: trigger warning, model violet… */
  icon: ReactNode;
  tone?: FlowStepTone;
  kind: string;
  title: string;
  /** One line under the title: the setting that tells steps apart (a path, a key). Mono unless `detailPlain`. */
  detail?: ReactNode;
  detailPlain?: boolean;
  /** A small pill at the right of the kind ("ok · 0,8 s", "Didn't run", "Soon"). */
  badge?: ReactNode;
  /** In a run: how the step went. Without it the card is the plain editor card. */
  state?: FlowStepState;
  /** Order the step ran in, as a bubble on the corner. */
  order?: number;
  selected?: boolean;
  /** Drawn but cannot be saved or run yet (a coming-soon kind). */
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Connection handles or anything the canvas places on the card. */
  children?: ReactNode;
}

/** A step of a Flow as a card on its canvas: what kind it is, its name, its key setting and, in a run, how it went. */
export function FlowStep({
  icon,
  tone = "neutral",
  kind,
  title,
  detail,
  detailPlain,
  badge,
  state,
  order,
  selected,
  muted,
  className,
  style,
  children,
}: FlowStepProps) {
  return (
    <div
      className={cx(
        "apx-flowstep",
        state && `apx-flowstep--${state}`,
        selected && "apx-flowstep--selected",
        muted && "apx-flowstep--muted",
        className,
      )}
      style={style}
    >
      {order !== undefined && <span className="apx-flowstep__order">{order}</span>}
      <span className="apx-flowstep__head">
        <span className={`apx-flowstep__tile apx-flowstep__tile--${tone}`} aria-hidden="true">
          {icon}
        </span>
        <span className="apx-flowstep__kind">{kind}</span>
        {badge !== undefined && <span className="apx-flowstep__badge">{badge}</span>}
      </span>
      <span className="apx-flowstep__title">{title}</span>
      {detail !== undefined && (
        <span className={cx("apx-flowstep__detail", detailPlain && "apx-flowstep__detail--plain")}>{detail}</span>
      )}
      {children}
    </div>
  );
}

/** The tone tile alone, for lists and chips that name a step kind. */
export function FlowStepTile({
  icon,
  tone = "neutral",
  size = "md",
  label,
}: {
  icon: ReactNode;
  tone?: FlowStepTone;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  return (
    <span
      className={`apx-flowstep__tile apx-flowstep__tile--${tone} apx-flowstep__tile--${size}`}
      {...(label ? { role: "img", "aria-label": label, title: label } : { "aria-hidden": true })}
    >
      {icon}
    </span>
  );
}
