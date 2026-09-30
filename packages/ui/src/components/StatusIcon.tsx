import { Check, Circle, X } from "lucide-react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export type StepStatus = "done" | "running" | "failed" | "pending";

export interface StatusIconProps {
  status: StepStatus;
  size?: number;
  className?: string;
}

/** Tiny state glyph for steps and tool calls: ✓ done, spinner running, ✕ failed, ○ pending. */
export function StatusIcon({ status, size = 14, className }: StatusIconProps) {
  const cls = cx("apx-status", `is-${status}`, className);
  if (status === "running")
    return (
      <span className={cls}>
        <Spinner size={size - 2} />
      </span>
    );
  if (status === "failed")
    return (
      <span className={cls}>
        <X size={size} strokeWidth={2.5} />
      </span>
    );
  if (status === "pending")
    return (
      <span className={cls}>
        <Circle size={size - 3} strokeWidth={2} />
      </span>
    );
  return (
    <span className={cls}>
      <Check size={size} strokeWidth={2.5} />
    </span>
  );
}
