import type { ReactNode } from "react";
import { cx } from "../cx";

export interface ActivityPillProps {
  /** What is happening: "Sending to Chief…", "Roby is writing…". */
  label: ReactNode;
  /** Avatars of who is involved, before the pill (AgentAvatar elements). */
  from?: ReactNode;
  /** Avatar after the pill — the recipient of a handoff. */
  to?: ReactNode;
  /** Tint of the dots and text. */
  tone?: "neutral" | "brand" | "violet" | "danger" | "info";
  className?: string;
}

/** Live activity between agents: animated dots + label, optionally flanked by sender/recipient avatars. */
export function ActivityPill({ label, from, to, tone = "neutral", className }: ActivityPillProps) {
  return (
    <div className={cx("apx-activity", `apx-tone--${tone}`, className)} role="status">
      {from && <span className="apx-activity__who">{from}</span>}
      <span className="apx-activity__pill">
        <span className="apx-activity__dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className="apx-activity__label">{label}</span>
      </span>
      {to && <span className="apx-activity__who">{to}</span>}
    </div>
  );
}
