// Discord-style rail avatar with smart initials.
//
//   Single-word ("iacrmar")           → big "I" + a "iacrm…" label below
//   Multi-word  ("panda project")     → big "PP" (first letter of each)
//   Single short ("apx", "ai")        → big initial + label fits without ellipsis
//
// Each project gets a deterministic colour pulled from PROJECT_TONES so the
// rail is visually scannable even when names are similar.
import { PROJECT_TONES, type ProjectTone } from "../../constants";
import { cn } from "../../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

interface Props {
  label: string;
  active?: boolean;
  onClick?: () => void;
  isAdd?: boolean;
  isSettings?: boolean;
  isDefault?: boolean;
  icon?: React.ReactNode;
  title?: string;
  testId?: string;
}

export function ProjectAvatar({ label, active, onClick, isAdd, isSettings, isDefault, icon, title, testId }: Props) {
  const text = label.trim() || "·";
  const { initials, subLabel } = computeInitialsAndSub(text);
  const tone: ProjectTone =
    isAdd || isSettings ? "indigo" : pickTone(text);
  const showSub = subLabel && !isAdd && !isSettings && !isDefault;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="group relative flex w-full cursor-pointer flex-col items-center gap-1"
          >
            <span
              className={cn(
                "flex size-10 items-center justify-center rounded-xl text-sm font-bold transition-all",
                active && "ring-2 ring-foreground ring-offset-2 ring-offset-card",
                isAdd && "border border-dashed border-muted-fg/50 bg-transparent text-muted-fg hover:bg-accent/60 hover:text-foreground",
                isSettings && "bg-muted text-muted-fg hover:bg-accent hover:text-foreground",
                isDefault && "overflow-hidden bg-muted",
                !isAdd && !isSettings && !isDefault && active && toneActive(tone),
                !isAdd && !isSettings && !isDefault && !active && toneIdle(tone),
              )}
            >
              {icon ?? initials}
            </span>
            {showSub && (
              <span className="block max-w-[3.6rem] truncate text-[9px] leading-tight text-muted-fg group-hover:text-foreground">
                {subLabel}
              </span>
            )}
          </button>
        }
      />
      <TooltipContent side="right">{title || label}</TooltipContent>
    </Tooltip>
  );
}

/** Public so list views can reuse the same rule (consistency). */
export function computeInitialsAndSub(name: string): { initials: string; subLabel: string | null } {
  const cleaned = name.trim().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return { initials: "·", subLabel: null };
  const words = cleaned.split(" ");
  if (words.length >= 2) {
    const ini = (words[0][0] + words[1][0]).toUpperCase();
    return { initials: ini, subLabel: shortLabel(cleaned) };
  }
  const single = words[0];
  if (single.length <= 4) {
    // "apx", "iacr" — fits without ellipsis
    return { initials: single[0].toUpperCase(), subLabel: single };
  }
  return { initials: single[0].toUpperCase(), subLabel: single.slice(0, 4) + "…" };
}

function shortLabel(s: string): string {
  return s.length > 6 ? s.slice(0, 5) + "…" : s;
}

/** Hash a string into a stable tone from PROJECT_TONES. */
function pickTone(s: string): ProjectTone {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return PROJECT_TONES[Math.abs(h) % PROJECT_TONES.length];
}

const TONE_IDLE: Record<ProjectTone, string> = {
  sky:     "bg-sky-500/15 text-sky-300 hover:bg-sky-500/25",
  violet:  "bg-violet-500/15 text-violet-300 hover:bg-violet-500/25",
  emerald: "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25",
  amber:   "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
  rose:    "bg-rose-500/15 text-rose-300 hover:bg-rose-500/25",
  indigo:  "bg-indigo-500/15 text-indigo-300 hover:bg-indigo-500/25",
  teal:    "bg-teal-500/15 text-teal-300 hover:bg-teal-500/25",
  fuchsia: "bg-fuchsia-500/15 text-fuchsia-300 hover:bg-fuchsia-500/25",
};
const TONE_ACTIVE: Record<ProjectTone, string> = {
  sky:     "bg-sky-500/30 text-sky-100",
  violet:  "bg-violet-500/30 text-violet-100",
  emerald: "bg-emerald-500/30 text-emerald-100",
  amber:   "bg-amber-500/30 text-amber-100",
  rose:    "bg-rose-500/30 text-rose-100",
  indigo:  "bg-indigo-500/30 text-indigo-100",
  teal:    "bg-teal-500/30 text-teal-100",
  fuchsia: "bg-fuchsia-500/30 text-fuchsia-100",
};
function toneIdle(t: ProjectTone)   { return TONE_IDLE[t]; }
function toneActive(t: ProjectTone) { return TONE_ACTIVE[t]; }
