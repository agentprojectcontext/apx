import { Activity, X } from "lucide-react";
import { cn } from "../../lib/cn";
import type { TimelineEntry, TimelineStats } from "../../lib/api/milestones";
import { MilestoneRail } from "./MilestoneRail";
import { t } from "../../i18n";

// This chat's timeline, beside the chat.
//
// It began as a collapsed rail ABOVE the transcript, and that was the wrong
// shape for the job. A rail on top is something you pass on the way to the
// messages: it costs vertical space in the one column that needs it, and the
// moment you scroll it is gone — which is exactly when you want it, because
// scrolling is what you were doing when you lost the thread.
//
// Beside it, it stays put while you read. The two are meant to be read AGAINST
// each other — a step in the rail, the messages that produced it — and that
// only works when both are on screen at once.
//
// ONE COMPONENT, TWO SHAPES, because they are the same need at two widths.
// Wide: a column on the right, the transcript narrows, both visible. Narrow
// (the phone, and the Android shell that loads /m/chat): there is no room for
// two columns, so it covers the chat and closes with the X — a view you open,
// read, and dismiss. A second mobile-only component would be two things to keep
// in step for one idea.
//
// Always mounted by the toggle, never self-hiding: somebody who opened this
// asked to see it, and a panel that decides there was nothing worth showing and
// vanishes reads as broken. Hence `hideWhenUneventful={false}` and an empty
// line of its own.

interface Props {
  entries: TimelineEntry[];
  stats: TimelineStats;
  loading?: boolean;
  onClose: () => void;
}

export function ChatTimelinePanel({ entries, stats, loading, onClose }: Props) {
  return (
    <aside
      data-testid="chat-timeline-panel"
      className={cn(
        // Narrow: over the conversation, the full pane, closable.
        "absolute inset-0 z-20 flex flex-col bg-background",
        // Wide: a column of its own beside it.
        "md:relative md:inset-auto md:z-auto md:w-80 md:shrink-0 md:border-l md:border-border md:bg-transparent",
      )}
      aria-label={t("milestones.title")}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="flex-1 truncate text-sm font-medium">{t("milestones.title")}</span>
        <button
          type="button"
          data-testid="chat-timeline-close"
          onClick={onClose}
          aria-label={t("common.close")}
          className="rounded-md p-1 text-muted-fg hover:bg-accent/40 hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {loading && !entries.length ? null : entries.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-fg">
            <Activity className="size-4" />
            {t("milestones.empty_chat")}
          </p>
        ) : (
          <MilestoneRail entries={entries} stats={stats} defaultOpen hideWhenUneventful={false} />
        )}
      </div>
    </aside>
  );
}
