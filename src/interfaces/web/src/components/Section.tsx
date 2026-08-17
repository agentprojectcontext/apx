import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface SectionProps {
  title: string;
  description?: string;
  /** Primary action for the page. Sits with the title, top-right. */
  action?: ReactNode;
  /**
   * Filters, tabs, segment controls — anything that narrows what is shown.
   *
   * Its own row BELOW the header, never in `action`. Mixing them put a
   * destructive-looking "Add" next to four state chips and made the primary
   * action just another button in a strip. See the page-layout rule in
   * AGENTS.md.
   */
  filters?: ReactNode;
  className?: string;
  children: ReactNode;
  // Fill the available height and let the body manage its own scroll instead of
  // growing the page. The card becomes a flex column (header pinned, body
  // flex-1); pair with a <PagedList fullHeight> child for an internal scroller
  // with a pinned pager. Needs a bounded-height parent (the tab content area is).
  fullHeight?: boolean;
}

export function Section({ title, description, action, filters, className, children, fullHeight }: SectionProps) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card p-5",
        fullHeight && "flex h-full min-h-0 flex-col",
        className
      )}
    >
      <header className={cn("flex items-start justify-between gap-4", fullHeight && "shrink-0")}>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted-fg">{description}</p>}
        </div>
        {action}
      </header>
      {filters ? (
        <div className={cn("mt-3 flex flex-wrap items-center gap-1.5", fullHeight && "shrink-0")}>
          {filters}
        </div>
      ) : null}
      <div className={cn("mt-4", fullHeight && "flex min-h-0 flex-1 flex-col")}>{children}</div>
    </section>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-fg">
      {children}
    </kbd>
  );
}

export function StatusDot({ ok }: { ok: boolean | null }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        ok === null ? "bg-muted-fg" : ok ? "bg-emerald-500" : "bg-red-500"
      )}
    />
  );
}
