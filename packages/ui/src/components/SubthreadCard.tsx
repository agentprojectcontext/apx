import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx";
import { Spinner } from "./Spinner";

export interface SubthreadCardProps {
  /** Avatar of the agent that was asked (AgentAvatar ~28px). */
  avatar: ReactNode;
  /** What was asked ("Buscar vuelos a Lima"). */
  title: ReactNode;
  /** Line under the title ("Roby → Scout"). */
  subtitle?: ReactNode;
  /** running shows a spinner; done / failed / waiting tint the state label. */
  status?: "running" | "done" | "failed" | "waiting";
  /** State label ("Trabajando", "Listo", "Falló"). */
  statusLabel?: ReactNode;
  /** The answer or progress summary, clamped to 3 lines. */
  summary?: ReactNode;
  /** Opens the sub-thread. */
  onOpen?: () => void;
  openLabel?: string;
  className?: string;
}

/** Agent-to-agent card inside a chat: who was asked what, its state and a summary; click opens the sub-thread. */
export function SubthreadCard({
  avatar,
  title,
  subtitle,
  status = "running",
  statusLabel,
  summary,
  onOpen,
  openLabel = "Abrir",
  className,
}: SubthreadCardProps) {
  return (
    <button type="button" className={cx("apx-subthread", className)} onClick={onOpen} aria-label={openLabel}>
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
        {summary && <span className="apx-subthread__summary">{summary}</span>}
      </span>
      <ChevronRight size={16} className="apx-subthread__chevron" />
    </button>
  );
}
