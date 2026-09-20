import { useMemo, useState } from "react";
import useSWR from "swr";
import { Activity } from "lucide-react";
import { Milestones, type Timeline, type TimelineEntry } from "../../lib/api/milestones";
import { Button, FilterChips } from "../ui";
import { MilestoneRail } from "./MilestoneRail";
import { t } from "../../i18n";

/** Written out per id rather than built as `milestones.range_${id}`: the
 *  translation key type is a union of literals, and a template string defeats
 *  it — which is how a key ends up missing from en.ts and silently serving the
 *  Spanish string. */
const RANGE_LABEL = {
  today: () => t("milestones.range_today"),
  week: () => t("milestones.range_week"),
  month: () => t("milestones.range_month"),
} as const;

// What happened across every chat, in the order it happened.
//
// This is the half that answers the complaint the per-chat rail cannot: you do
// not know which chat to open. A request that never got an answer, a step the
// agent recorded as failed — those are invisible until somebody happens to
// scroll back through the right conversation, and nobody does. Here they are
// one filter away, whichever channel they arrived on.
//
// Built from the LEDGER, one file per day, so a range costs its own days rather
// than every conversation the project has ever had. That is why the ranges are
// ranges and not "everything".

const RANGES = [
  { id: "today", days: 1 },
  { id: "week", days: 7 },
  { id: "month", days: 30 },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

function sinceFor(days: number): string {
  const d = new Date(Date.now() - days * 86400_000);
  return d.toISOString().slice(0, 10) + "T00:00:00Z";
}

/** Did this entry end in a state somebody still has to do something about? */
function unfinished(e: TimelineEntry): boolean {
  if (e.state === "open" || e.state === "failed") return true;
  return e.milestones.some((m) => m.state === "open" || m.state === "failed");
}

export function ProjectTimeline({ pid }: { pid: string }) {
  const [range, setRange] = useState<RangeId>("week");
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);

  const days = RANGES.find((r) => r.id === range)!.days;
  const { data, isLoading } = useSWR<Timeline>(
    ["project-timeline", pid, range],
    () => Milestones.forProject(pid, { since: sinceFor(days), limit: 200 }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const entries = useMemo(() => {
    const all = data?.entries ?? [];
    return onlyUnfinished ? all.filter(unfinished) : all;
  }, [data, onlyUnfinished]);

  // Recomputed rather than taken from the response: the response counts the
  // whole range, and once a filter is on, a header describing a different set
  // of rows than the ones underneath it is worse than no header.
  const stats = useMemo(
    () => ({
      total: entries.length,
      open: entries.filter((e) => e.state === "open").length,
      done: entries.filter((e) => e.state === "done").length,
      failed: entries.filter((e) => e.state === "failed" || e.milestones.some((m) => m.state === "failed")).length,
    }),
    [entries]
  );

  return (
    <div className="flex flex-col gap-3" data-testid="project-timeline">
      {/* The range is one chip row (FilterChips is mutually exclusive, which a
          range is); "Unfinished only" is a separate toggle because it crosses
          the range rather than competing with it. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterChips
          value={range}
          onChange={(v) => setRange(v as RangeId)}
          testIdPrefix="timeline-range"
          options={RANGES.map((r) => ({
            value: r.id,
            label: RANGE_LABEL[r.id](),
          }))}
        />
        <Button
          size="sm"
          variant={onlyUnfinished ? "primary" : "ghost"}
          data-testid="timeline-unfinished"
          aria-pressed={onlyUnfinished}
          onClick={() => setOnlyUnfinished((v) => !v)}
        >
          {t("milestones.only_unfinished")}
        </Button>
      </div>

      {isLoading ? null : entries.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-fg">
          <Activity className="size-4" />
          {t("milestones.empty")}
        </p>
      ) : (
        <MilestoneRail entries={entries} stats={stats} defaultOpen />
      )}
    </div>
  );
}
