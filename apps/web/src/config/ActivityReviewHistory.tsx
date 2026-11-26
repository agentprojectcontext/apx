import type { ActivityReviewOutcome, ActivityReviewRun, ActivityReviewStatus } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, PickRow, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { aheadLabel, dayLabel } from "../common/format.ts";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { go, nav } from "../shell/nav.ts";
import { SubHead } from "./SectionHead.tsx";
import "./activity-review.css";

const PAGE = 10;
const DAY = 86_400_000;
const TONE: Record<ActivityReviewOutcome, "violet" | "info" | "brand" | "neutral"> = {
  pending: "violet",
  accepted: "info",
  done: "brand",
  dropped: "neutral",
  deleted: "neutral",
};

/** When reviews run, and each past review with what it read and what became of what it proposed. */
export function ActivityReviewHistory({ status }: { status: ActivityReviewStatus }) {
  const t = useT();
  const [runs, setRuns] = useState<ActivityReviewRun[]>();
  const [next, setNext] = useState<string>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (before?: string) => {
    setBusy(true);
    setError(false);
    try {
      const page = await client.call("activity_review.history", { limit: PAGE, ...(before ? { before } : {}) });
      setRuns((old) => (before ? [...(old ?? []), ...page.runs] : page.runs));
      setNext(page.next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  // A finished review changes the screen's status: reload the history with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated each render; the status is the trigger.
  useEffect(() => {
    void load();
  }, [status.last_at, status.state]);
  const open = (task: string) => {
    nav.set({ config: null });
    go.view("tasks");
    go.task(task);
  };
  return (
    <section className="review-history" aria-label={t("review.history")}>
      <SubHead>{t("review.history")}</SubHead>
      {status.settings.enabled && (
        <p className="config__lead">
          {[
            status.last_at ? t("review.lastAt", { when: dayLabel(status.last_at) }) : undefined,
            status.next_at ? t("review.nextAt", { when: aheadLabel(status.next_at) }) : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {error && (
        <p role="alert" className="config__lead">
          {t("review.historyError")}{" "}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {t("review.retry")}
          </Button>
        </p>
      )}
      {!runs ? (
        !error && <Skeleton height={96} shape="block" />
      ) : !runs.length ? (
        <EmptyState variant="dashed" icon={<Icons.History />}>
          {t("review.historyEmpty")}
        </EmptyState>
      ) : (
        <ol className="review-history__list">
          {runs.map((run) => (
            <li key={run.id} className="review-history__run">
              <div className="review-history__head">
                <span className="review-history__when">{dayLabel(run.at)}</span>
                <span className="review-history__read">{readLine(run, t)}</span>
              </div>
              {run.proposals.length ? (
                run.proposals.map((p) => {
                  const outcome = (
                    <Badge key="outcome" tone={TONE[p.outcome]}>
                      {t(`review.outcome.${p.outcome}`)}
                    </Badge>
                  );
                  // A deleted task has nowhere to open: its title stays, as plain text.
                  return p.outcome === "deleted" ? (
                    <div key={p.task_id} className="review-history__gone">
                      <span>{p.title}</span>
                      {outcome}
                    </div>
                  ) : (
                    <PickRow
                      key={p.task_id}
                      title={p.title}
                      muted={p.outcome === "dropped"}
                      trailing={outcome}
                      onClick={() => open(p.task_id)}
                    />
                  );
                })
              ) : (
                <p className="review-history__none">{t(endLine(run))}</p>
              )}
            </li>
          ))}
        </ol>
      )}
      {next && (
        <Button size="sm" variant="ghost" loading={busy} disabled={busy} onClick={() => void load(next)}>
          {t("review.older")}
        </Button>
      )}
    </section>
  );
}

/** What a review read, in words: "Read 12 chats from the last week". Reviews before the history only say so. */
function readLine(run: ActivityReviewRun, t: ReturnType<typeof useT>): string {
  if (run.chats === undefined) return t("review.readEarlier");
  const chats = t(run.chats === 1 ? "review.chats.one" : "review.chats.other", { count: String(run.chats) });
  const span = run.since ? Date.parse(run.at) - Date.parse(run.since) : 0;
  if (span >= 6 * DAY) return t("review.readWeek", { chats });
  if (span >= 0.75 * DAY) return t("review.readDay", { chats });
  return t("review.readSince", { chats, when: dayLabel(run.since ?? run.at) });
}

/** A review that left no proposal: why. */
function endLine(run: ActivityReviewRun) {
  if (run.state === "working") return "review.state.working";
  if (run.state === "failed") return "review.state.failed";
  if (run.state === "cancelled") return "review.state.cancelled";
  if (run.state === "uncertain") return "review.state.uncertain";
  return "review.state.nothing";
}
