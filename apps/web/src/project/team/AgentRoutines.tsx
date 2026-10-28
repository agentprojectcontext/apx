import type { Agent } from "@apx/protocol";
import { Badge, EmptyState, IconButton, Icons, Switch } from "@apx/ui";
import { aheadLabel, shortWhen } from "../../common/format.ts";
import { draftOf, runRoutine, saveRoutine, useRoutines } from "../../data/routines.ts";
import { useT } from "../../i18n/index.ts";
import { scheduleText } from "../../routines/Schedule.tsx";
import { go } from "../../shell/nav.ts";
import { RUN_STATE } from "./AgentActivity.tsx";

/**
 * The agent's heartbeat: each routine it runs, on or paused, when it ticks next, when it ran last and how that went;
 * turn one on or off, or run it now.
 */
export function AgentRoutines({ agent }: { agent: Agent }) {
  const t = useT();
  const routines = useRoutines((s) => s.routines).filter(
    (r) => r.agent_id === agent.id && r.action !== "relay" && r.action !== "mail",
  );
  if (!routines.length)
    return (
      <EmptyState icon={<Icons.HeartPulse />} title={t("agent.routines.empty")}>
        {t("agent.routines.emptyBody", { name: agent.name })}
      </EmptyState>
    );
  return (
    <ul className="agentrt">
      {routines.map((r) => {
        const last = r.last;
        const tone = !last
          ? "neutral"
          : last.state === "failed"
            ? "danger"
            : last.state === "completed"
              ? "brand"
              : "neutral";
        return (
          <li key={r.id} className={`agentrt__item${r.enabled ? "" : " is-paused"}`}>
            <div className="agentrt__head">
              <span className={`agentrt__dot${r.enabled ? " is-on" : ""}`} aria-hidden="true" />
              <span className="agentrt__name">{r.name}</span>
              <Badge tone={r.enabled ? "brand" : "neutral"}>
                {r.enabled ? t("agent.routines.on") : t("agent.routines.paused")}
              </Badge>
              <span className="board__spacer" />
              <IconButton
                size="sm"
                label={t("routines.runNow")}
                icon={<Icons.Play size={13} />}
                onClick={() => void runRoutine(r.id)}
              />
              <Switch
                size="sm"
                checked={r.enabled}
                aria-label={t("routines.enabled")}
                onCheckedChange={(on) => void saveRoutine({ ...draftOf(r), enabled: on })}
              />
            </div>
            <dl className="agentrt__facts">
              <dt>{t("agent.routines.tick")}</dt>
              <dd>{scheduleText(r.schedule, t)}</dd>
              <dt>{t("agent.routines.next")}</dt>
              <dd>{r.enabled && r.next_run_at ? aheadLabel(r.next_run_at) : "—"}</dd>
              <dt>{t("agent.routines.last")}</dt>
              <dd>
                {last ? (
                  <button type="button" className="agentrt__last" onClick={() => go.inboxThread(last.thread_id)}>
                    {shortWhen(last.started_at)}
                    <Badge tone={tone}>
                      {last.model_called === false ? t("agent.routines.skipped") : t(RUN_STATE[last.state])}
                    </Badge>
                  </button>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}
