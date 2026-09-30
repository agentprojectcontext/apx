import type { BlobName } from "../blobs/catalog";
import { cx } from "../cx";
import { AgentAvatar } from "./AgentAvatar";

export interface AgentChipProps {
  /** Agent name shown in the chip. */
  name: string;
  blob?: BlobName | (string & {});
  /** Tint: violet (default, other agents), brand (your secretary), info, neutral. */
  tone?: "violet" | "brand" | "info" | "neutral";
  /** plain = colored name inline in running text; chip = tinted pill (system notes, headers). */
  variant?: "plain" | "chip";
  onClick?: () => void;
}

/** Inline agent mention: tiny blob + colored name, in messages and system notes. */
export function AgentChip({ name, blob, tone = "violet", variant = "chip", onClick }: AgentChipProps) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx("apx-agentchip", `apx-agentchip--${variant}`, `apx-tone--${tone}`)}
    >
      <AgentAvatar name={name} blob={blob} size={14} animated={false} />
      {name}
    </Tag>
  );
}
