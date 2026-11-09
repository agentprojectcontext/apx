import "../styles/panel-parts.css";
import type { Job } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, Skeleton, Spinner } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { elapsed, shortWhen } from "../common/format.ts";
import { useNow } from "../common/useNow.ts";
import { cancelJob } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";
import { useNav } from "../shell/nav.ts";
import { closeTab, useOpenTabs } from "./openTabs.ts";
import { LIST_TAB, PanelGroup, PanelList, PanelRow, PanelTabs } from "./PanelTabs.tsx";
import { PanelHeader } from "./SidePanel.tsx";
import { screenText } from "./terminalText.ts";

const running = (job: Job) => job.state === "working" && !job.ended_at;

/** The command as the agent typed it. */
const commandOf = (job: Job) => job.title.replace(/^Ran\s+/, "");

const statusOf = (t: T, job: Job) =>
  running(job)
    ? t("terminal.running")
    : job.state === "canceled"
      ? t("terminal.stopped")
      : job.exit_code != null
        ? t("terminal.exit", { code: job.exit_code })
        : t("terminal.done");

const failed = (job: Job) => job.state === "failed" || (job.exit_code != null && job.exit_code !== 0);

/**
 * The commands this chat's agent ran, in the foreground or in the background: running ones first, then those that
 * ended. Each opens as a tab with what it printed, live while it runs.
 */
export function ProcessesPanel() {
  const t = useT();
  const root = useNav((s) => s.threadId);
  const connection = useData((s) => s.connection);
  const agents = useData((s) => s.agents);
  const [jobs, setJobs] = useState<{ running: Job[]; finished: Job[] }>();
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string>();
  const now = useNow(!!jobs?.running.length);
  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      setJobs(await client.call("jobs.list", { thread: root, finished: 50 }));
      setError(false);
    } catch {
      setError(true);
    }
  }, [root]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (connection === "online") void refresh();
    const stop = watchEvents((ev) => {
      if (ev.type !== "job.updated" || ev.job.thread_id !== root || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 400);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [refresh, connection, root]);
  const all = jobs ? [...jobs.running, ...jobs.finished] : [];
  const active = all.filter(running);
  const done = all.filter((j) => !running(j));
  const key = root && `processes:${root}`;
  const open = useOpenTabs(key, selected);
  const tabs = open.flatMap((id) => {
    const job = all.find((j) => j.id === id);
    return job ? [{ id, label: commandOf(job), dot: running(job) ? ("busy" as const) : ("idle" as const) }] : [];
  });
  const shown = selected ? all.find((j) => j.id === selected) : undefined;
  const row = (job: Job) => {
    const who = job.agent_name ?? (job.agent_id ? agents[job.agent_id]?.name : undefined);
    return (
      <PanelRow
        key={job.id}
        className="procs__row"
        mono
        leading={running(job) ? <Spinner size={12} /> : <Icons.Terminal size={14} />}
        title={commandOf(job)}
        description={
          <>
            {who && `${who} · `}
            {job.background && `${t("terminal.background")} · `}
            <span className={failed(job) ? "procs__exit is-failed" : "procs__exit"}>{statusOf(t, job)}</span>
          </>
        }
        trailing={running(job) ? elapsed(job.started_at, now) : shortWhen(job.ended_at ?? job.started_at)}
        onClick={() => setSelected(job.id)}
      />
    );
  };
  return (
    <>
      <PanelHeader kind="processes" />
      <PanelTabs
        label={t("panel.processes")}
        list={t("panelTabs.all", { n: all.length })}
        tabs={tabs}
        value={shown ? shown.id : LIST_TAB}
        onSelect={(id) => setSelected(id === LIST_TAB ? undefined : id)}
        onClose={(id) => {
          if (key) closeTab(key, id);
          if (id === selected) setSelected(undefined);
        }}
      />
      {shown ? (
        <CommandOutput key={shown.id} job={shown} />
      ) : error ? (
        <div className="sidepanel__body">
          <EmptyState
            icon={<Icons.TriangleAlert />}
            title={t("procs.failed")}
            action={
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : !jobs ? (
        <Skeleton className="term__loading" />
      ) : !all.length ? (
        <div className="sidepanel__body">
          <EmptyState icon={<Icons.Layers />} title={t("procs.empty")}>
            {t("procs.emptyBody")}
          </EmptyState>
        </div>
      ) : (
        <PanelList label={t("procs.list")}>
          <PanelGroup title={t("processes.active", { n: active.length })} />
          {active.map(row)}
          {!active.length && <p className="plist__empty">{t("procs.noneActive")}</p>}
          <PanelGroup title={t("processes.done", { n: done.length })} />
          {done.map(row)}
          {!done.length && <p className="plist__empty">{t("procs.noneDone")}</p>}
        </PanelList>
      )}
    </>
  );
}

/** One command opened as a tab: what it is, how it went, and what it printed, following the end while it runs. */
function CommandOutput({ job }: { job: Job }) {
  const t = useT();
  const [output, setOutput] = useState<string>();
  const box = useRef<HTMLPreElement>(null);
  const live = running(job);
  useEffect(() => {
    let stop = false;
    const read = async () => {
      const r = await client.call("jobs.get", { job: job.id, max_chars: 20_000 }).catch(() => undefined);
      if (stop || !r) return;
      const el = box.current;
      const atEnd = !el || el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
      setOutput(screenText(r.output));
      // Follow the end like a terminal, unless the owner scrolled up to read.
      if (atEnd)
        requestAnimationFrame(() => {
          if (box.current) box.current.scrollTop = box.current.scrollHeight;
        });
    };
    void read();
    const timer = live ? setInterval(() => void read(), 1500) : undefined;
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [live, job.id]);
  return (
    <div className="sidepanel__body procs__view">
      <div className="procs__head">
        <div className="procs__headmain">
          <code className="procs__cmd">{commandOf(job)}</code>
          <span className="procs__meta">
            <span className={failed(job) ? "procs__exit is-failed" : live ? "procs__exit is-running" : "procs__exit"}>
              {statusOf(t, job)}
            </span>
            {job.cwd && (
              <span className="procs__cwd" title={job.cwd}>
                {job.cwd}
              </span>
            )}
          </span>
        </div>
        {live && (
          <IconButton
            size="sm"
            label={t("terminal.stop")}
            icon={<Icons.Square size={12} />}
            onClick={() => void cancelJob(job.id)}
          />
        )}
      </div>
      <pre ref={box} className="procs__out">
        {output === undefined ? t("procs.loadingOutput") : output || t("procs.noOutput")}
      </pre>
    </div>
  );
}
