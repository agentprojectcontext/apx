import type { Routine, RoutineRun } from "@apx/protocol";
import { Badge, type BadgeProps, Icons, Skeleton, Tag } from "@apx/ui";
import { memo, useEffect } from "react";
import { QuietBadge } from "../chat/QuietMark.tsx";
import { Transcript } from "../chat/Transcript.tsx";
import { dayLabel } from "../common/format.ts";
import { usePageVisible } from "../common/useInView.ts";
import { loadThread, markRead } from "../data/actions.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { markText, type OutcomeTone, outcomeMarks, promptOf } from "./runOutcome.ts";

const BADGE_TONE: Record<OutcomeTone, NonNullable<BadgeProps["tone"]>> = {
  ran: "brand",
  told: "info",
  skipped: "neutral",
  failed: "danger",
  live: "violet",
};

/**
 * One run inside the routine's chat: a line with when it ran and how it ended, its instructions folded, then what was
 * said in it, drawn by the chat's own transcript. Its thread loads when the block is first shown.
 */
export const RunBlock = memo(function RunBlock({
  run,
  index,
  routine,
  previous,
}: {
  run: RoutineRun;
  /** Its place among all the routine's runs, oldest first: the timeline jumps to it. */
  index: number;
  routine: Routine;
  /** The run before it, to tell when the instructions changed between them. */
  previous: RoutineRun | undefined;
}) {
  const t = useT();
  const id = run.thread_id;
  const ready = useData((s) => s.ready);
  const thread = useData((s) => s.threads[id]);
  const load = useData((s) => s.threadLoad[id]);
  const prompt = useData((s) => promptOf(s.messages[id]));
  const before = useData((s) => (previous ? promptOf(s.messages[previous.thread_id]) : undefined));
  const visible = usePageVisible();

  useEffect(() => {
    if (ready && load == null) void loadThread(id);
  }, [id, ready, load]);
  const unread = thread?.unread ?? 0;
  useEffect(() => {
    if (unread > 0 && visible && load === "ready") void markRead(id);
  }, [id, unread, visible, load]);

  const when = dayLabel(run.started_at);
  const changed = prompt != null && before != null && prompt !== before;
  return (
    <section className="rtchat__run" data-run={index} aria-label={when}>
      <div className="rtchat__head">
        {changed && (
          <div className="rtchat__changed">
            <Icons.Pencil size={12} />
            {t("routineChat.changed")}
          </div>
        )}
        <div className="rtchat__divider">
          <span className="rtchat__when">{when}</span>
          {outcomeMarks(run, routine.action).map((m) =>
            m.quiet ? (
              <QuietBadge key={m.key} className="rtchat__mark" />
            ) : (
              <Badge
                key={m.key}
                tone={BADGE_TONE[m.tone]}
                dot
                className="rtchat__mark"
                title={m.detail ? t(m.detail) : undefined}
              >
                {markText(m, t)}
              </Badge>
            ),
          )}
        </div>
        {prompt != null && (
          <details className="rtchat__prompt">
            <summary>
              <Icons.Clock size={13} />
              <span className="rtchat__prompttitle">{t("thread.routinePrompt", { name: routine.name })}</span>
              {run.prompt_version != null && (
                <Tag
                  className="rtchat__version"
                  title={prompt !== routine.prompt ? t("routineChat.earlier") : undefined}
                >
                  v{run.prompt_version}
                </Tag>
              )}
              <Icons.ChevronRight size={13} className="rtchat__promptchev" />
            </summary>
            <p className="rtchat__prompttext">{prompt}</p>
          </details>
        )}
      </div>
      {thread && load === "ready" ? (
        <Transcript thread={thread} />
      ) : load === "error" ? null : (
        <div className="rtchat__loading" aria-busy="true">
          <Skeleton width="70%" height={56} shape="block" />
        </div>
      )}
    </section>
  );
});
