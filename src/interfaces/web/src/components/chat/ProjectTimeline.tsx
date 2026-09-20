import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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

/**
 * The chat a step happened in, as a URL — or null when there is no honest one.
 *
 * Addressed the way the chat screen reads its own selection (`queryForChat`):
 * an agent's conversation is `agent` + `conv`. A step with no conversation id —
 * the super-agent's own threads, a milestone recorded outside one — gets no
 * link rather than a guess, because a link that opens the wrong chat is worse
 * than a row you have to find yourself.
 *
 * `agent_slug`, never `agent`: the latter is the display name the turn showed.
 */
function chatHrefFor(pid: string, e: TimelineEntry): string | null {
  if (!e.conversation_id || !e.agent_slug) return null;
  const q = new URLSearchParams({ agent: e.agent_slug, conv: e.conversation_id });
  return `/p/${pid}/chat?${q.toString()}`;
}

interface Props {
  pid: string;
  /**
   * Show only the newest N steps, and put the way to the rest in `moreHref`.
   *
   * The glance on the Overview is a GLANCE: a real week came back 85 steps
   * long, which is not a summary of anything — it is the transcript again, in
   * a different shape, pushing everything under it off the page. The screen of
   * its own is where the whole range belongs, so it passes no cap.
   */
  limit?: number;
  /** Where "view all" goes. Omitted on the screen that already IS all of it. */
  moreHref?: string;
}

export function ProjectTimeline({ pid, limit, moreHref }: Props) {
  const [range, setRange] = useState<RangeId>("week");
  const [onlyUnfinished, setOnlyUnfinished] = useState(false);

  const days = RANGES.find((r) => r.id === range)!.days;
  const { data, isLoading } = useSWR<Timeline>(
    ["project-timeline", pid, range],
    () => Milestones.forProject(pid, { since: sinceFor(days), limit: 200 }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const filtered = useMemo(() => {
    const all = data?.entries ?? [];
    return onlyUnfinished ? all.filter(unfinished) : all;
  }, [data, onlyUnfinished]);

  // The NEWEST n, not the first n: the timeline reads forward, so a cap taken
  // off the front would show the oldest steps of the range and hide today's.
  const entries = useMemo(
    () => (limit && filtered.length > limit ? filtered.slice(-limit) : filtered),
    [filtered, limit],
  );
  const hidden = filtered.length - entries.length;

  // Recomputed rather than taken from the response: the response counts the
  // whole range, and once a filter is on, a header describing a different set
  // of rows than the ones underneath it is worse than no header.
  const stats = useMemo(
    () => ({
      total: entries.length,
      open: entries.filter((e) => e.state === "open").length,
      done: entries.filter((e) => e.state === "done").length,
      failed: entries.filter((e) => e.state === "failed" || e.milestones.some((m) => m.state === "failed")).length,
      superseded: entries.filter((e) => e.state === "superseded").length,
      running: entries.filter((e) => e.state === "running").length,
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
        <MilestoneRail
          entries={entries}
          stats={stats}
          defaultOpen
          chatHref={(e) => chatHrefFor(pid, e)}
          footer={
            hidden > 0 && moreHref ? (
              <NavLink
                to={moreHref}
                data-testid="timeline-view-all"
                className="text-muted-fg hover:text-foreground hover:underline"
              >
                {t("milestones.view_more", { n: hidden })}
              </NavLink>
            ) : null
          }
        />
      )}
    </div>
  );
}
