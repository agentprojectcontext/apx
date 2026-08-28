import { BlobAvatar } from "./BlobAvatar";
import { isBlobKey } from "./blobPresets";
import { cn } from "../../lib/cn";
import { Tip } from "../ui/tip";
import type { AgentFace } from "../../types/daemon";
import claudeLogo from "../../assets/cli/claude.webp";
import codexLogo from "../../assets/cli/codex.webp";
import opencodeLogo from "../../assets/cli/opencode.png";
import cursorLogo from "../../assets/cli/cursor.svg";

// Coding-CLI identities aren't project agents — they have no blob — but they DO
// have a brand mark. When an a2a participant (or any face) is one of these
// engines, wear its logo instead of a bare initial disc.
const CLI_LOGOS: Record<string, string> = {
  claude: claudeLogo,
  "claude-code": claudeLogo,
  codex: codexLogo,
  opencode: opencodeLogo,
  cursor: cursorLogo,
  "cursor-agent": cursorLogo,
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

/** Default blob for surfaces loading before super-agent config arrives. */
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

// A face is whatever the API resolved for one participant — declared with the
// rest of the daemon payload types, and re-exported here because this is where
// every caller already imports it from.
export type { AgentFace };

/**
 * A cluster of faces for a group chat (a2a). Overlapping discs, each ringed in
 * the surface colour so they read as separated (Gmail-style). Past `max`,
 * the rest collapse into a "+N" chip. `ringClass` must match the background the
 * group sits on — that ring colour is what makes the overlap look clean.
 *
 * When `onFaceClick` is set, each openable face is its own control (tooltip +
 * click) so a group header can send you to agent A or agent B, not "the group".
 */
export function AgentAvatarGroup({
  faces,
  size = 22,
  max = 3,
  className,
  onFaceClick,
  faceOpenable,
  "data-testid": dataTestId,
}: {
  faces: AgentFace[];
  size?: number;
  max?: number;
  className?: string;
  onFaceClick?: (face: AgentFace) => void;
  /** When set, only faces that return true become buttons; others keep a tip. */
  faceOpenable?: (face: AgentFace) => boolean;
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
      {shown.map((f, i) => {
        const label = (f.name || f.slug || "").trim();
        const openable = !!onFaceClick && (faceOpenable ? faceOpenable(f) : true);
        const face = <AgentAvatar {...f} size={size} />;
        const body = openable ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFaceClick?.(f);
            }}
            aria-label={label || undefined}
            className="rounded-full transition-opacity hover:opacity-80 active:opacity-70"
          >
            {face}
          </button>
        ) : (
          <span className="inline-flex">{face}</span>
        );
        return (
          <span
            key={f.slug || `${label}-${i}`}
            className="inline-flex"
            style={{ marginLeft: i === 0 ? 0 : -overlap, zIndex: i + 1 }}
          >
            {label ? <Tip content={label}>{body}</Tip> : body}
          </span>
        );
      })}
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
