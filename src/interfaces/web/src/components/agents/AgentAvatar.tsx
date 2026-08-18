import { BlobAvatar } from "./BlobAvatar";
import { isBlobKey } from "./blobPresets";
import { cn } from "../../lib/cn";

/**
 * One agent, one face — everywhere.
 *
 * The inbox row, the chat header and the message bubbles used to draw three
 * different things for the same agent (animated blob / coloured disc / a
 * generic `Bot` glyph), so the same conversation looked like three different
 * correspondents. This is the single renderer they all call: blob preset when
 * the agent has one, else its emoji, else a stable coloured initial.
 */

/** The blob the super-agent wears. Mirrors core/stores/agent-inbox.js, which
 *  stamps the same key on the super-agent's inbox row — if the two drift, Roby
 *  changes face between the list and the thread. */
export const SUPER_AGENT_ICON = "noche";

/** Stable colour per agent, so the same agent is the same disc every time. */
const DISC_COLOURS = [
  "bg-emerald-500", "bg-orange-500", "bg-violet-500", "bg-sky-500",
  "bg-rose-500", "bg-amber-500", "bg-teal-500", "bg-fuchsia-500",
];

export function agentDiscColour(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return DISC_COLOURS[h % DISC_COLOURS.length];
}

export interface AgentFace {
  /** Blob-preset key (see blobPresets), when the agent has one. */
  icon?: string | null;
  emoji?: string | null;
  /** Display name — used for the fallback initial and to seed the colour. */
  name?: string | null;
}

export function AgentAvatar({
  icon,
  emoji,
  name,
  size = 32,
  className,
}: AgentFace & { size?: number; className?: string }) {
  const label = (name || "").trim();
  const seed = label || icon || emoji || "?";

  if (isBlobKey(icon)) {
    return <BlobAvatar preset={icon} size={size} seed={seed} className={cn("shrink-0", className)} />;
  }

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        agentDiscColour(seed),
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {emoji || (label ? label.slice(0, 1).toUpperCase() : "·")}
    </span>
  );
}
