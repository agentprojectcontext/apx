/**
 * "Hoy" / "Ayer" / "4 de septiembre" — the line that says the conversation
 * moved to another day.
 *
 * Sticky: in a thread with three months in it the day you are reading has to
 * stay named while you scroll through it, or the divider is only useful at the
 * exact moment it passes. It sits at the top of the scroller until the next one
 * pushes it out, the way every chat app does it.
 */
export function DayDivider({ label }: { label: string }) {
  return (
    <div data-testid="chat-day-divider" className="sticky top-0 z-10 flex justify-center py-1">
      <span
        // Its own near-opaque pill rather than a transparent one: it scrolls
        // OVER the bubbles, and a translucent label sitting on top of a line of
        // text is unreadable exactly when it is doing its job.
        className="rounded-full border border-border/60 bg-card/90 px-2.5 py-0.5 text-[11px] font-medium text-muted-fg shadow-sm backdrop-blur"
      >
        {label}
      </span>
    </div>
  );
}
