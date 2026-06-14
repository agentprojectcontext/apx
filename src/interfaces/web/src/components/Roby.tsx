import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Roby — the APX mascot. Web mirror of the CLI version in src/core/mascot.js:
// a chunky ▄███████▄ head with two screen-eyes and a tiny mouth, drawn as clean
// emerald line art. Keep the FACES table below in sync with the CLI's MOODS so
// the same character shows up identically across terminal and web.
export type RobyMood = "happy" | "wave" | "confused" | "sad" | "excited" | "sleeping";

// Each mood = a pair of pupils, a mouth glyph, and an optional floating accent.
// NB: the sad mouth is "◠" (single-cell) rather than the CLI's "︵": that glyph
// is East-Asian-wide (~1.7 cells) in the browser monospace font and would push
// the head's right edge out of line. "◠" is the single-width frown inverse of
// the happy "‿".
const FACES: Record<RobyMood, { eyes: [string, string]; mouth: string; top?: string }> = {
  happy:    { eyes: ["◕", "◕"], mouth: "‿" },
  wave:     { eyes: ["◕", "◕"], mouth: "▽", top: "·" },
  confused: { eyes: ["◑", "◐"], mouth: "o", top: "?" },
  sad:      { eyes: ["╥", "╥"], mouth: "◠" },
  excited:  { eyes: ["★", "★"], mouth: "▽", top: "✦" },
  sleeping: { eyes: ["−", "−"], mouth: "‿", top: "z z" },
};

export function Roby({ mood = "happy", className }: { mood?: RobyMood; className?: string }) {
  const face = FACES[mood] ?? FACES.happy;
  const [el, er] = face.eyes;
  // Recessed eye "screens" + floating accent sit in a dimmer emerald; the bright
  // frame, pupils and mouth inherit text-emerald-400 from the wrapper.
  const dim = "text-emerald-700 dark:text-emerald-600/70";
  return (
    <div
      aria-hidden
      className={cn(
        "select-none whitespace-pre font-mono leading-none text-emerald-400",
        className
      )}
    >
      {face.top && (
        <div>
          <span className={dim}>{`      ${face.top}`}</span>
        </div>
      )}
      <div>{"   ▄███████▄"}</div>
      <div>
        {"  █ "}
        <span className={dim}>{"██"}</span>
        {"   "}
        <span className={dim}>{"██"}</span>
        {" █"}
      </div>
      <div>{`  █  ${el}   ${er}  █`}</div>
      <div>{`  █    ${face.mouth}    █`}</div>
      <div>{"   ▀███████▀"}</div>
    </div>
  );
}

// Centered "Roby + message" layout shared by the 404 and the project-not-found
// screens. `title` is optional and rendered large (e.g. a giant "404").
export function RobyEmpty({
  mood = "confused",
  title,
  titleClassName,
  message,
  action,
  className,
  testId,
}: {
  mood?: RobyMood;
  title?: ReactNode;
  titleClassName?: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("grid h-full place-items-center p-8", className)} data-testid={testId}>
      <div className="flex flex-col items-center text-center">
        <Roby mood={mood} className="mb-6 text-sm" />
        {title != null && (
          <div
            className={cn(
              "font-mono font-semibold leading-none tracking-tight text-foreground",
              titleClassName
            )}
          >
            {title}
          </div>
        )}
        {message != null && <p className="mt-4 max-w-sm text-sm text-muted-fg">{message}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}
