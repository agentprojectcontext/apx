import { useState } from "react";
import { CornerUpRight } from "lucide-react";
import { cn } from "../../lib/cn";
import { forwardSourceLabel, type Forwarded } from "../../lib/forwarded";
import { channelLabel } from "../../lib/channels";
import { t } from "../../i18n";

// A message somebody carried in from another conversation, drawn as a quote.
//
// It has one job the pasted text it replaces could never do: say, without being
// read, that these words were said SOMEWHERE ELSE. So the three facts are on
// the card itself — which session, who said it, when — and the quote is set
// apart by the rule down its left edge rather than by being in a different
// bubble. It sits INSIDE the turn that carried it, above what the sender typed,
// because that is the shape of the message: here is the thing, here is what I
// say about it.
//
// The source is clickable when the reader can get there: a quote that names a
// conversation and offers no way into it is a citation with the page number
// torn off.

interface Props {
  fwd: Forwarded;
  /** Open the session this came from. Absent → the source is named but not a
   *  link (the surface has nowhere to navigate to, e.g. a nested preview). */
  onOpen?: () => void;
  /** Phone shaping: tighter padding, the quote clamped harder. */
  compact?: boolean;
}

/** How many lines of the quote show before it is folded (`line-clamp-6` below —
 *  Tailwind needs the class spelled out, so the two are kept side by side).
 *  Enough for a short message to arrive whole, which most forwards are, and few
 *  enough that a long one does not bury the sentence written under it. */
const CLAMP_LINES = 6;

export function ForwardedQuote({ fwd, onOpen, compact }: Props) {
  const [open, setOpen] = useState(false);
  const source = forwardSourceLabel(fwd);
  const who = fwd.author === "user" ? t("forward.author_you") : fwd.author_name || t("forward.author_agent");
  // The channel only earns its chip when it says something the title does not.
  // "Telegram · Telegram" is the same word twice wearing two shapes.
  const channel = fwd.from.channel ? channelLabel(fwd.from.channel) : "";
  const showChannel = !!channel && channel.toLowerCase() !== source.toLowerCase();
  const lines = fwd.text.split("\n").length;
  const foldable = lines > CLAMP_LINES || fwd.text.length > 320;

  return (
    <div
      data-testid="forwarded-quote"
      className={cn(
        // The rule down the left is the whole visual idea: the words belong to
        // somebody else, and the eye is told so before it starts reading.
        "w-full min-w-0 rounded-lg rounded-l-sm border border-border/70 border-l-2 border-l-primary/60 bg-surface-soft/70",
        compact ? "px-2 py-1.5" : "px-2.5 py-2",
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-none text-muted-fg">
        <CornerUpRight size={11} className="shrink-0 text-primary/80" />
        <span className="shrink-0 font-medium text-foreground/80">{t("forward.from_label")}</span>
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            data-testid="forwarded-open-source"
            className="min-w-0 max-w-[16rem] truncate font-medium text-primary hover:underline"
            title={t("forward.open_source")}
          >
            {source}
          </button>
        ) : (
          <span className="min-w-0 max-w-[16rem] truncate font-medium text-foreground/80">{source}</span>
        )}
        {showChannel && (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide">
            {channel}
          </span>
        )}
        <span className="shrink-0">· {who}</span>
        {fwd.ts && <span className="shrink-0">· {shortWhen(fwd.ts)}</span>}
      </div>

      <div
        className={cn(
          "mt-1 whitespace-pre-wrap text-[13px] leading-snug text-foreground/85 [overflow-wrap:anywhere]",
          !open && foldable && "line-clamp-6",
        )}
      >
        {fwd.text}
      </div>

      {(foldable || fwd.truncated) && (
        <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-fg">
          {foldable && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="font-medium text-primary hover:underline"
            >
              {open ? t("forward.show_less") : t("forward.show_more")}
            </button>
          )}
          {/* The original was longer than the quote cap. Said out loud, because
              a quote that ends mid-sentence with no explanation reads as the
              sender having trailed off. */}
          {fwd.truncated && <span>{t("forward.truncated")}</span>}
        </div>
      )}
    </div>
  );
}

/** "17/09 19:42" — the day and the time, which is what a quote needs. Not
 *  `relativeWhen`: "hace 3 días" is fine for a row in a list you are scanning,
 *  and useless on a citation you may be reading months later. */
function shortWhen(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${d.toLocaleDateString([], { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return "";
  }
}
