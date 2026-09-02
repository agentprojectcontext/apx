import { type ReactNode } from "react";
import { Search } from "lucide-react";
import { isNativeShell } from "../../lib/net";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * The chrome the phone's list screens share: a header that owns the status-bar
 * inset, and a scroll body that runs under the tab bar.
 *
 * Same header as the chat list by construction — title left, round icon buttons
 * right, a pill search under it — because three tabs that each invent their own
 * top of the screen read as three apps.
 */
export function MobileListHeader({
  title,
  actions,
  query,
  onQuery,
  searchPlaceholder,
  filters,
}: {
  title: string;
  actions?: ReactNode;
  query: string;
  onQuery: (v: string) => void;
  searchPlaceholder?: string;
  /** Chips row under the search box. */
  filters?: ReactNode;
}) {
  // Inside the app the WebView is already laid out below the system bars, so
  // this header must not pay for them again (see lib/net.ts).
  const native = isNativeShell();
  return (
    <header className={cn(
      "shrink-0 border-b border-border px-4 pb-3",
      native ? "pt-1.5" : "pt-[max(0.75rem,env(safe-area-inset-top))]",
    )}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="flex items-center gap-1">{actions}</div>
      </div>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={searchPlaceholder ?? t("inbox.search")}
          className="h-10 w-full rounded-full border border-border bg-muted/30 pl-9 pr-3 text-[15px] outline-none placeholder:text-muted-fg focus:border-primary/50"
        />
      </div>
      {filters && (
        // Chips scroll sideways rather than wrapping: five states wrapped onto
        // a second line push the first row of the list off a small screen.
        <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
          {filters}
        </div>
      )}
    </header>
  );
}

/** One filter chip. Picked = brand green, the app's one "this is selected". */
export function MobileChip({
  active, onClick, children, testId,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/50 bg-primary/12 text-primary"
          : "border-border text-muted-fg active:bg-accent/60",
      )}
    >
      {children}
    </button>
  );
}

/** Sticky section heading inside the scrolling list. */
export function MobileGroupHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-background/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-fg backdrop-blur">
      <span>{label}</span>
      <span className="tabular-nums opacity-70">{count}</span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// When something is due
// ────────────────────────────────────────────────────────────────────────────

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

/** The buckets in the order the eye should meet them. */
export const DUE_ORDER: DueBucket[] = ["overdue", "today", "tomorrow", "week", "later", "none"];

/** Local calendar day as YYYY-MM-DD — the granularity a due date is written in. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDay(d);
}

/**
 * Which bucket a due date falls in.
 *
 * Compared as calendar days, not as instants: a task due "today" stored as
 * midnight is already in the past by 9am, and calling it overdue every single
 * morning is how a red badge stops meaning anything.
 */
export function dueBucket(due: string | null | undefined): DueBucket {
  if (!due) return "none";
  const day = String(due).slice(0, 10);
  const today = localDay(new Date());
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day === dayOffset(1)) return "tomorrow";
  if (day <= dayOffset(7)) return "week";
  return "later";
}

export function dueBucketLabel(bucket: DueBucket): string {
  return t(`mobile.due.${bucket}` as never);
}

/**
 * Group rows into due buckets, dropping the empty ones.
 *
 * `keep` is what a closed list passes to opt out: "vencida" is a fact about
 * work still owed, and printing it over a task that was finished last month is
 * just wrong.
 */
export function groupByDue<T>(
  rows: T[],
  dueOf: (row: T) => string | null | undefined,
  { keep = true }: { keep?: boolean } = {},
): { bucket: DueBucket | null; rows: T[] }[] {
  if (!keep) return rows.length ? [{ bucket: null, rows }] : [];
  const by = new Map<DueBucket, T[]>();
  for (const row of rows) {
    const b = dueBucket(dueOf(row));
    const list = by.get(b);
    if (list) list.push(row);
    else by.set(b, [row]);
  }
  return DUE_ORDER
    .filter((b) => by.has(b))
    .map((b) => ({
      bucket: b,
      // Soonest first inside a bucket; the undated ones keep the server's order.
      rows: by.get(b)!.sort((x, y) => String(dueOf(x) ?? "").localeCompare(String(dueOf(y) ?? ""))),
    }));
}

/** The little date on the right of a row. Red only when it is actually late. */
export function DueChip({ due, late }: { due: string | null | undefined; late: boolean }) {
  if (!due) return null;
  const day = String(due).slice(0, 10);
  const [y, m, d] = day.split("-").map(Number);
  const bucket = dueBucket(due);
  const text =
    bucket === "today" ? t("mobile.due.today")
    : bucket === "tomorrow" ? t("mobile.due.tomorrow")
    // The year only when it is not this one: "12 mar" is what a person says.
    : new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        ...(y === new Date().getFullYear() ? {} : { year: "2-digit" }),
      });
  return (
    <span className={cn(
      "shrink-0 whitespace-nowrap text-[11px] tabular-nums",
      late ? "font-semibold text-red-600 dark:text-red-400" : "text-muted-fg",
    )}>
      {text}
    </span>
  );
}
