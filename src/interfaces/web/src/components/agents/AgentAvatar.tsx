import { BlobAvatar } from "./BlobAvatar";
import { isBlobKey } from "./blobPresets";
import { cn } from "../../lib/cn";
import claudeLogo from "../../assets/cli/claude.webp";
import codexLogo from "../../assets/cli/codex.webp";
import opencodeLogo from "../../assets/cli/opencode.png";

// Coding-CLI identities aren't project agents — they have no blob — but they DO
// have a brand mark. When an a2a participant (or any face) is one of these
// engines, wear its logo instead of a bare initial disc.
const CLI_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  "claude-code": claudeLogo,
  codex: codexLogo,
  opencode: opencodeLogo,
};

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

/**
 * A cluster of faces for a group chat (a2a). Overlapping discs, each ringed in
 * the surface colour so they read as separated (Gmail-style). Past `max`,
 * the rest collapse into a "+N" chip. `ringClass` must match the background the
 * group sits on — that ring colour is what makes the overlap look clean.
 */
export function AgentAvatarGroup({
  faces,
  size = 22,
  max = 3,
  className,
  "data-testid": dataTestId,
}: {
  faces: AgentFace[];
  size?: number;
  max?: number;
  className?: string;
  "data-testid"?: string;
}) {
  const shown = faces.slice(0, max);
  const extra = faces.length - shown.length;
  const overlap = Math.round(size * 0.3);
  return (
    <span
      className={cn("flex shrink-0 items-center", className)}
      data-testid={dataTestId}
      data-participant-count={faces.length}
    >
      {shown.map((f, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: i + 1 }}>
          <AgentAvatar {...f} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          aria-hidden
          className="inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-fg"
          style={{ marginLeft: -overlap, zIndex: shown.length + 1, width: size, height: size, fontSize: Math.round(size * 0.4) }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
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

  const logo = CLI_LOGOS[label.toLowerCase()] || CLI_LOGOS[(icon || "").toLowerCase()];
  if (logo) {
    return (
      <img
        src={logo}
        alt=""
        aria-hidden
        className={cn("shrink-0 rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }

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
