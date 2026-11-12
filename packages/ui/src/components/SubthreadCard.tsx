import { ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export interface SubthreadCardProps {
  /** Avatar of the agent that was asked (AgentAvatar ~24px). */
  avatar: ReactNode;
  /** What was asked ("Find flights to Lima"). */
  title: ReactNode;
  /** Line under the title ("Roby → Scout"). */
  subtitle?: ReactNode;
  /** running shows a spinner; done / failed / waiting tint the state label. */
  status?: "running" | "done" | "failed" | "waiting";
  /** State label ("Working", "Done", "Failed"). */
  statusLabel?: ReactNode;
  /** How long it took, under the state ("42 s"). */
  time?: ReactNode;
  /** The answer it handed back (rendered Markdown, say), shown when the row is unfolded. */
  summary?: ReactNode;
  /** A line under the answer ("Failed: send mail"). */
  meta?: ReactNode;
  /** Unfolded on first render (the owner's own question keeps its answer in view). */
  defaultOpen?: boolean;
  /** Whether it is unfolded, when the caller keeps that (so it survives the card being drawn again). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opens the sub-thread: the action at the foot of the unfolded card. */
  onOpen?: () => void;
  /** The foot action's text ("Open Bruno's chat"). */
  openLabel?: string;
  className?: string;
}

/**
 * Agent-to-agent card inside a chat: one row with who was asked what, its state and time. The row unfolds the answer,
 * with the action that opens the sub-thread at its foot.
 */
export function SubthreadCard({
  avatar,
  title,
  subtitle,
  status = "running",
  statusLabel,
  time,
  summary,
  meta,
  defaultOpen = false,
  open: shown,
  onOpenChange,
  onOpen,
  openLabel = "Open",
  className,
}: SubthreadCardProps) {
  const [own, setOwn] = useState(defaultOpen);
  const open = shown ?? own;
  const body = useId();
  return (
    <div className={cx("apx-subthread", open && "is-open", className)}>
      <button
        type="button"
        className="apx-subthread__head"
        aria-expanded={open}
        aria-controls={open ? body : undefined}
        onClick={() => {
          setOwn(!open);
          onOpenChange?.(!open);
        }}
      >
        <ChevronRight size={14} className="apx-subthread__chevron" aria-hidden />
        <span className="apx-subthread__avatar">{avatar}</span>
        <span className="apx-subthread__main">
          <span className="apx-subthread__title">{title}</span>
          {subtitle && <span className="apx-subthread__sub">{subtitle}</span>}
        </span>
        <span className="apx-subthread__side">
          <span className={cx("apx-subthread__state", `is-${status}`)}>
            {status === "running" && <Spinner size={12} />}
            {statusLabel}
          </span>
          {time && <span className="apx-subthread__time">{time}</span>}
        </span>
      </button>
      {open && (
        <div id={body} className="apx-subthread__body">
          {summary && <div className="apx-subthread__summary">{summary}</div>}
          {meta && <div className="apx-subthread__meta">{meta}</div>}
          {onOpen && (
            <button type="button" className="apx-subthread__open" onClick={onOpen}>
              {openLabel}
              <ChevronRight size={13} aria-hidden />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
