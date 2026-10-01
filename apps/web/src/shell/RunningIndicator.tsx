import { AgentAvatar, Icons, Popover, SegmentedControl, Spinner } from "@apx/ui";
import { useMemo, useState } from "react";
import { elapsed } from "../common/format.ts";
import { blobOf, isWorking, projectName, threadAgent } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "./nav.ts";

/** Topbar pill: agents working (or waiting for you) · background jobs. The popover jumps to each chat. */
export function RunningIndicator() {
  const t = useT();
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const runs = useData((s) => s.runs);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("agents");
  const active = useMemo(
    () =>
      Object.values(threads)
        .filter((t) => isWorking(t.state) || t.state === "input-required")
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [threads],
  );
  const startedAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of Object.values(runs)) {
      if (r.ended_at) continue;
      const prev = m.get(r.thread_id);
      if (!prev || r.started_at > prev) m.set(r.thread_id, r.started_at);
    }
    return m;
  }, [runs]);
  const working = active.filter((t) => isWorking(t.state)).length;
  const waiting = active.length - working;
  // No background jobs API yet: the tab is there, honestly empty.
  const background = 0;

  return (
    <Popover
      align="end"
      width={360}
      open={open}
      onOpenChange={setOpen}
      label={t("running.label")}
      trigger={
        <button
          type="button"
          className={active.length ? "running is-active" : "running"}
          aria-label={t("running.aria", { working, waiting, background })}
        >
          {working > 0 && <Spinner size={12} />}
          <span className="running__count">
            {working}
            <Icons.Bot size={14} />
          </span>
          {waiting > 0 && (
            <span className="running__count is-waiting">
              {waiting}
              <Icons.Hand size={14} />
            </span>
          )}
          <span className="running__div" />
          <span className="running__count is-light">
            {background}
            <Icons.Layers size={14} />
          </span>
          <Icons.ChevronDown size={14} />
        </button>
      }
    >
      <SegmentedControl
        size="sm"
        className="running__tabs"
        label={t("running.label")}
        value={tab}
        onValueChange={setTab}
        options={[
          { value: "agents", label: <TabLabel text={t("running.tab.agents")} n={active.length} /> },
          { value: "bg", label: <TabLabel text={t("running.tab.background")} n={background} /> },
        ]}
      />
      {tab === "agents" ? (
        active.length ? (
          <div className="running__list">
            {active.map((th) => {
              const agent = threadAgent(th, agents);
              const since = startedAt.get(th.id);
              return (
                <button
                  key={th.id}
                  type="button"
                  className="running__row"
                  onClick={() => {
                    setOpen(false);
                    go.inboxThread(th.id);
                  }}
                >
                  <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={28} animated={false} />
                  <span className="running__item">
                    <span className="running__title">{th.title}</span>
                    <span className="running__sub">
                      {projectName(projects, th.project_id)} · {agent?.name ?? t("common.agent")}
                    </span>
                  </span>
                  {th.state === "input-required" ? (
                    <span className="running__waiting">{t("running.waitingForYou")}</span>
                  ) : (
                    since && <span className="running__elapsed">{elapsed(since)}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="running__empty">{t("running.empty")}</p>
        )
      ) : (
        <p className="running__empty">{t("running.backgroundEmpty")}</p>
      )}
    </Popover>
  );
}

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <>
      {text}
      <span className="running__tabn">{n}</span>
    </>
  );
}
