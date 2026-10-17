import type { Agent, Result, Run } from "@apx/protocol";
import { Badge, Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { formatSeconds, shortWhen } from "../../common/format.ts";
import { agentRuns } from "../../data/team.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

const TRIGGER: Record<Run["trigger"], MessageKey> = {
  user: "agent.activity.user",
  routine: "agent.activity.routine",
  channel: "agent.activity.channel",
  a2a: "agent.activity.a2a",
  a2a_result: "agent.activity.a2aResult",
  surface: "agent.activity.surface",
  system: "agent.activity.system",
};
const STATE_TONE = { completed: "brand", failed: "danger", canceled: "neutral" } as const;
/** A run's state in the owner's words. */
export const RUN_STATE: Record<Run["state"], MessageKey> = {
  submitted: "usage.state.submitted",
  working: "usage.state.working",
  "input-required": "usage.state.waiting",
  completed: "usage.state.completed",
  failed: "usage.state.failed",
  canceled: "usage.state.canceled",
};

const secs = (r: Run) => (r.ended_at ? (Date.parse(r.ended_at) - Date.parse(r.started_at)) / 1000 : undefined);

/** What the agent did, newest first: where each turn came from, how it ended, how long it took; opens its chat. */
export function AgentActivity({ agent }: { agent: Agent }) {
  const t = useT();
  const [page, setPage] = useState<Result<"runs.list">>();
  const [more, setMore] = useState(true);
  useEffect(() => {
    let current = true;
    setPage(undefined);
    void agentRuns(agent.id).then((r) => {
      if (!current) return;
      setPage(r);
      setMore(r.runs.length >= 30);
    });
    return () => {
      current = false;
    };
  }, [agent.id]);
  const older = useCallback(async () => {
    const last = page?.runs.at(-1);
    if (!page || !last) return;
    const next = await agentRuns(agent.id, last.started_at);
    setMore(next.runs.length >= 30);
    setPage({ runs: [...page.runs, ...next.runs], threads: [...page.threads, ...next.threads] });
  }, [agent.id, page]);

  if (!page) return <Skeleton shape="block" height={120} />;
  if (!page.runs.length)
    return (
      <EmptyState icon={<Icons.Activity />} title={t("agent.activity.empty")}>
        {t("agent.activity.emptyBody", { name: agent.name })}
      </EmptyState>
    );
  const title = (id: string) => page.threads.find((x) => x.id === id)?.title ?? id;
  return (
    <div className="agentact">
      <ol className="agentact__list">
        {page.runs.map((r) => {
          const s = secs(r);
          return (
            <li key={r.id}>
              <button type="button" className="agentact__row" onClick={() => go.inboxThread(r.thread_id)}>
                <span className={`agentact__dot is-${r.state}`} aria-hidden="true" />
                <span className="agentact__main">
                  <span className="agentact__title">{title(r.thread_id)}</span>
                  <span className="agentact__meta">
                    {t(TRIGGER[r.trigger])}
                    {r.tool_calls ? ` · ${t("agent.activity.tools", { n: r.tool_calls })}` : ""}
                    {s != null ? ` · ${formatSeconds(s)}` : ""}
                    {r.error && r.state === "failed" ? ` · ${r.error.slice(0, 80)}` : ""}
                  </span>
                </span>
                {r.end_reason === "step_limit" ? (
                  <Badge tone="warning">{t("usage.state.stepLimit")}</Badge>
                ) : (
                  <Badge tone={STATE_TONE[r.state as keyof typeof STATE_TONE] ?? "neutral"}>
                    {t(RUN_STATE[r.state])}
                  </Badge>
                )}
                <time className="agentact__when" dateTime={r.started_at}>
                  {shortWhen(r.started_at)}
                </time>
              </button>
            </li>
          );
        })}
      </ol>
      {more && (
        <Button size="sm" variant="ghost" onClick={() => void older()}>
          {t("agent.activity.older")}
        </Button>
      )}
    </div>
  );
}
