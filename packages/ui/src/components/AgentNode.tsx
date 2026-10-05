import { Crown, Eye, MessageCircle } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "../cx";
import { AgentAvatar } from "./AgentAvatar";
import { EngineIcon } from "./EngineIcon";

export type AgentNodeStat = { icon: ReactNode; value: number; label: string };

export interface AgentNodeProps {
  name: string;
  slug?: string;
  blob?: string;
  role?: string;
  /** Up to two lines; the slot is always reserved so cards share one height. */
  description?: string;
  /** Muted stand-in when there is no real description (keeps the two-line slot). */
  descriptionEmpty?: boolean;
  /** Shown as a crowned badge: "Orchestrator", "Super-agent". */
  lead?: string;
  /** Engine id for the chip (`inherit`, `claude`, `acp:gemini`…) and its visible label. */
  engine?: string;
  engineLabel?: string;
  stats?: AgentNodeStat[];
  /** running: a turn is live (the avatar's ring pulses); waiting: it waits for the owner (amber dot). */
  status?: "idle" | "running" | "waiting";
  selected?: boolean;
  /** Faded while another branch is highlighted. */
  dimmed?: boolean;
  viewLabel: string;
  chatLabel: string;
  waitingLabel?: string;
  onOpen?(): void;
  onChat?(): void;
  onHover?(on: boolean): void;
  className?: string;
  style?: CSSProperties;
}

/** An agent as a card on the team canvas: who it is, what it runs on, how busy it is, and two ways in. */
export function AgentNode({
  name,
  slug,
  blob,
  role,
  description,
  descriptionEmpty = false,
  lead,
  engine,
  engineLabel,
  stats = [],
  status = "idle",
  selected = false,
  dimmed = false,
  viewLabel,
  chatLabel,
  waitingLabel,
  onOpen,
  onChat,
  onHover,
  className,
  style,
}: AgentNodeProps) {
  return (
    <article
      className={cx(
        "apx-agentnode",
        `is-${status}`,
        selected && "is-selected",
        dimmed && "is-dimmed",
        lead && "is-lead",
        className,
      )}
      style={style}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      <button type="button" className="apx-agentnode__hit" aria-label={`${viewLabel}: ${name}`} onClick={onOpen} />
      <header className="apx-agentnode__top">
        <span className="apx-agentnode__avatar">
          <AgentAvatar name={name} {...(blob ? { blob } : {})} size={32} animated={status === "running"} />
          {status === "waiting" && <span className="apx-agentnode__wait" title={waitingLabel} />}
        </span>
        <span className="apx-agentnode__names">
          <span className="apx-agentnode__name">{name}</span>
          {slug && <span className="apx-agentnode__slug">{slug}</span>}
        </span>
      </header>
      {(lead || role) && (
        <div className="apx-agentnode__role">
          {lead ? (
            <span className="apx-agentnode__lead">
              <Crown size={12} />
              {lead}
            </span>
          ) : (
            <span className="apx-agentnode__chip">{role}</span>
          )}
        </div>
      )}
      <p className={cx("apx-agentnode__desc", descriptionEmpty && "is-empty")}>{description || "\u00a0"}</p>
      {stats.length > 0 && (
        <ul className="apx-agentnode__stats">
          {stats.map((s) => (
            <li key={s.label} title={s.label}>
              {s.icon}
              {s.value}
            </li>
          ))}
        </ul>
      )}
      <footer className="apx-agentnode__foot">
        <button type="button" className="apx-agentnode__act" onClick={onOpen}>
          <Eye size={13} />
          {viewLabel}
        </button>
        <button type="button" className="apx-agentnode__act is-chat" onClick={onChat}>
          <MessageCircle size={13} />
          {chatLabel}
        </button>
        {engine && (
          <span className="apx-agentnode__engine" title={engineLabel ?? engine}>
            <EngineIcon engine={engine} size={12} />
            <span className="apx-agentnode__enginelabel">{engineLabel ?? engine}</span>
          </span>
        )}
      </footer>
    </article>
  );
}
