import { ChevronRight } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export interface SubthreadCardProps {
  /** Avatar of the agent that was asked (AgentAvatar ~28px). */
  avatar: ReactNode;
  /** What was asked ("Find flights to Lima"). */
  title: ReactNode;
  /** Line under the title ("Roby → Scout"). */
  subtitle?: ReactNode;
  /** running shows a spinner; done / failed / waiting tint the state label. */
  status?: "running" | "done" | "failed" | "waiting";
  /** State label ("Working", "Done", "Failed"). */
  statusLabel?: ReactNode;
  /** The report it handed back (rendered Markdown, say): folded to a few lines, unfolded on demand. */
  summary?: ReactNode;
  /** A line under the report ("Took 3 min 10 s"). */
  meta?: ReactNode;
  /** Opens the sub-thread. */
  onOpen?: () => void;
  openLabel?: string;
  moreLabel?: string;
  lessLabel?: string;
  className?: string;
}

/**
 * Agent-to-agent card inside a chat: who was asked what and its state (the head opens the sub-thread), then the
 * report it handed back, folded when long.
 */
export function SubthreadCard({
  avatar,
  title,
  subtitle,
  status = "running",
  statusLabel,
  summary,
  meta,
  onOpen,
  openLabel = "Open",
  moreLabel = "Show more",
  lessLabel = "Show less",
  className,
}: SubthreadCardProps) {
  const body = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const hasReport = Boolean(summary);
  // The report mounts when the run ends, and the folded box keeps its height as it grows: watch what is inside it.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el || open || !hasReport) return;
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    ro?.observe(el);
    for (const child of el.children) ro?.observe(child);
    return () => ro?.disconnect();
  }, [open, hasReport]);
  return (
    <div className={cx("apx-subthread", className)}>
      <button type="button" className="apx-subthread__head" onClick={onOpen} aria-label={openLabel}>
        <span className="apx-subthread__avatar">{avatar}</span>
        <span className="apx-subthread__main">
          <span className="apx-subthread__top">
            <span className="apx-subthread__title">{title}</span>
            <span className={cx("apx-subthread__state", `is-${status}`)}>
              {status === "running" && <Spinner size={12} />}
              {statusLabel}
            </span>
          </span>
          {subtitle && <span className="apx-subthread__sub">{subtitle}</span>}
        </span>
        <ChevronRight size={16} className="apx-subthread__chevron" />
      </button>
      {summary && (
        <div className="apx-subthread__report">
          <div ref={body} className={cx("apx-subthread__summary", !open && "is-folded", !open && long && "is-long")}>
            {summary}
          </div>
          {(long || open) && (
            <button
              type="button"
              className="apx-subthread__more"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? lessLabel : moreLabel}
            </button>
          )}
        </div>
      )}
      {meta && <div className="apx-subthread__meta">{meta}</div>}
    </div>
  );
}
