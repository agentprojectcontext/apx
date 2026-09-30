import type { ReactNode } from "react";
import { cx } from "../cx";

export interface MessageMetaProps {
  /** Agent that answered, shown as a small tag. */
  agent?: ReactNode;
  /** Engine/model id, e.g. "codex:gpt-6.1". */
  model?: ReactNode;
  /** Reasoning effort, e.g. "medium". */
  effort?: ReactNode;
  /** Extra items (duration, tokens). */
  children?: ReactNode;
  className?: string;
}

/** The line under an agent turn: who answered, with which model and effort. Mono in classic. */
export function MessageMeta({ agent, model, effort, children, className }: MessageMetaProps) {
  const parts = [model, effort].filter(Boolean);
  return (
    <div className={cx("apx-msgmeta", className)}>
      {agent && <span className="apx-msgmeta__agent">{agent}</span>}
      {parts.map((p, i) => (
        <span key={i} className="apx-msgmeta__part">
          {p}
        </span>
      ))}
      {children}
    </div>
  );
}
