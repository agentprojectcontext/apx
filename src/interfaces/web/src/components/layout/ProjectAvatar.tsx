// Discord-style rail avatar with smart initials.
//
//   Single-word ("acmecorp")          → big "A" + a "acmec…" label below
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
  /** Pin the colour instead of hashing it from the label — for fixed rail
   *  entries (inbox, modules) whose identity isn't a project name. */
  tone?: ProjectTone;
  /** Override the caption under the icon. The computed one truncates a long
   *  label to four characters, which is fine for a project slug and useless
   *  for a two-word module name. */
  sublabel?: string;
}

export function ProjectAvatar({ label, active, onClick, isAdd, isSettings, isDefault, icon, title, testId, tone: toneProp, sublabel }: Props) {
  const text = label.trim() || "·";
  const { initials, subLabel } = computeInitialsAndSub(text);
  const tone: ProjectTone =
    toneProp ?? (isAdd || isSettings ? "indigo" : pickTone(text));
  const caption = sublabel ?? subLabel;
  const showSub = caption && !isAdd && !isSettings && !isDefault;
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
                active && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                isAdd && "border border-dashed border-muted-fg/50 bg-transparent text-muted-fg hover:bg-accent/60 hover:text-foreground",
                isSettings && "bg-muted text-muted-fg hover:bg-accent hover:text-foreground dark:bg-muted/60",
                isDefault && "overflow-hidden bg-muted",
                !isAdd && !isSettings && !isDefault && active && toneActive(tone),
                !isAdd && !isSettings && !isDefault && !active && toneIdle(tone),
              )}
            >
              {icon ?? initials}
            </span>
            {showSub && (
              <span className={cn(
                "block max-w-[3.6rem] truncate text-[9px] leading-tight group-hover:text-foreground",
                active ? "font-medium text-foreground" : "text-muted-fg",
              )}>
                {caption}
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

// Two grounds, two palettes. On dark, a 15% wash with 300-level text reads;
// on white the same pair is a pale smudge, so light gets a stronger wash and
// 800-level text. Every tone is declared for both themes — no tone may be
// defined only inside `dark:`.
const TONE_IDLE: Record<ProjectTone, string> = {
  sky:     "bg-sky-500/20 text-sky-800 hover:bg-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300 dark:hover:bg-sky-500/25",
  violet:  "bg-violet-500/20 text-violet-800 hover:bg-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300 dark:hover:bg-violet-500/25",
  emerald: "bg-emerald-500/20 text-emerald-800 hover:bg-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25",
  amber:   "bg-amber-500/20 text-amber-800 hover:bg-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25",
  rose:    "bg-rose-500/20 text-rose-800 hover:bg-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:hover:bg-rose-500/25",
  indigo:  "bg-indigo-500/20 text-indigo-800 hover:bg-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25",
  teal:    "bg-teal-500/20 text-teal-800 hover:bg-teal-500/30 dark:bg-teal-500/15 dark:text-teal-300 dark:hover:bg-teal-500/25",
  fuchsia: "bg-fuchsia-500/20 text-fuchsia-800 hover:bg-fuchsia-500/30 dark:bg-fuchsia-500/15 dark:text-fuchsia-300 dark:hover:bg-fuchsia-500/25",
};
const TONE_ACTIVE: Record<ProjectTone, string> = {
  sky:     "bg-sky-500/35 text-sky-900 dark:bg-sky-500/30 dark:text-sky-100",
  violet:  "bg-violet-500/35 text-violet-900 dark:bg-violet-500/30 dark:text-violet-100",
  emerald: "bg-emerald-500/35 text-emerald-900 dark:bg-emerald-500/30 dark:text-emerald-100",
  amber:   "bg-amber-500/35 text-amber-900 dark:bg-amber-500/30 dark:text-amber-100",
  rose:    "bg-rose-500/35 text-rose-900 dark:bg-rose-500/30 dark:text-rose-100",
  indigo:  "bg-indigo-500/35 text-indigo-900 dark:bg-indigo-500/30 dark:text-indigo-100",
  teal:    "bg-teal-500/35 text-teal-900 dark:bg-teal-500/30 dark:text-teal-100",
  fuchsia: "bg-fuchsia-500/35 text-fuchsia-900 dark:bg-fuchsia-500/30 dark:text-fuchsia-100",
};
function toneIdle(t: ProjectTone)   { return TONE_IDLE[t]; }
function toneActive(t: ProjectTone) { return TONE_ACTIVE[t]; }

/** Compact avatar tokens for list rows (overflow / collapsed menus). Reuses
 *  the same initials + tone as the rail so a project reads identically in both
 *  the rail and the popover. */
export function projectTone(name: string): { initials: string; idleClass: string } {
  const { initials } = computeInitialsAndSub(name);
  return { initials, idleClass: TONE_IDLE[pickTone(name)] };
}
