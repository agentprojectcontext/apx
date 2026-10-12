import { AgentAvatar, EngineIcon, Icons, Popover, SegmentedControl, Spinner } from "@apx/ui";
import { lazy, Suspense, useMemo, useState } from "react";
import { elapsed } from "../common/format.ts";
import { useNow } from "../common/useNow.ts";
import { blobOf, isWorking, projectName, threadAgent } from "../data/identity.ts";
import { isBackground } from "../data/jobs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, showsChat, useNav } from "./nav.ts";

// The jobs list shows only once its tab is opened: not part of the first screen's script.
const JobList = lazy(() => import("./JobList.tsx").then((m) => ({ default: m.JobList })));

/** Topbar pill: agents working (or waiting for you) · background jobs. The popover jumps to each chat or transcript. */
export function RunningIndicator() {
  const t = useT();
  const chatShown = useNav(showsChat);
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const runs = useData((s) => s.runs);
  const jobs = useData((s) => s.jobs);
  const engines = useData((s) => s.engines);
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
  const bgRunning = useMemo(() => jobs.running.filter(isBackground), [jobs.running]);
  const background = bgRunning.length;
  const now = useNow(open);

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
          className={active.length || background ? "running is-active" : "running"}
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
      {chatShown && (
        <button
          type="button"
          className="jobs__fold"
          onClick={() => {
            setOpen(false);
            go.processes();
          }}
        >
          {t("panel.processes")}
        </button>
      )}
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
                  {th.engine ? (
                    <EngineIcon engine={th.engine} tile size={28} />
                  ) : (
                    <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={28} animated={false} />
                  )}
                  <span className="running__item">
                    <span className="running__title">{th.title}</span>
                    <span className="running__sub">
                      {projectName(projects, th.project_id)} ·{" "}
                      {th.engine
                        ? (engines.find((e) => e.id === th.engine)?.label ?? th.engine)
                        : (agent?.name ?? t("common.agent"))}
                    </span>
                  </span>
                  {th.state === "input-required" ? (
                    <span className="running__waiting">{t("running.waitingForYou")}</span>
                  ) : (
                    since && <span className="running__elapsed">{elapsed(since, now)}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="running__empty">{t("running.empty")}</p>
        )
      ) : (
        <Suspense fallback={<Spinner size={14} />}>
          <JobList
            running={bgRunning}
            finished={jobs.finished}
            now={now}
            onOpen={(j) => {
              setOpen(false);
              go.thread(j.thread_id);
            }}
          />
        </Suspense>
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
