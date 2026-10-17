import type { Job, Thread } from "@apx/protocol";
import { AgentAvatar, EmptyState, IconButton, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { useNow } from "../common/useNow.ts";
import { loadThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { blobOf, isWorking, threadAgent } from "../data/identity.ts";
import { watchEvents } from "../data/live.ts";
import { data, useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { JobList } from "../shell/JobList.tsx";
import { go, useNav } from "../shell/nav.ts";
import { chatDescendants } from "./process-scope.ts";
import { PanelHeader } from "./SidePanel.tsx";

/** Not over yet: working, waiting on the owner, or waiting for a free delegation slot. */
const going = (state: Thread["state"]) => isWorking(state) || state === "input-required" || state === "queued";

/** This chat's delegated conversations and commands, leaving its transcript in place. */
export function ProcessesPanel() {
  const t = useT();
  const root = useNav((s) => s.threadId);
  const selected = useNav((s) => (s.panelParent === root ? s.panelThread : undefined));
  const thread = useData((s) => (selected ? s.threads[selected] : undefined));
  const loadState = useData((s) => (selected ? s.threadLoad[selected] : undefined));
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const connection = useData((s) => s.connection);
  const [children, setChildren] = useState<Thread[]>();
  const [jobs, setJobs] = useState<{ running: Job[]; finished: Job[] }>({ running: [], finished: [] });
  const [error, setError] = useState(false);
  const now = useNow(true);
  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const [all, commands] = await Promise.all([
        client.call("threads.list", { root_thread: root, include_subthreads: true, include_archived: true }),
        client.call("jobs.list", { thread: root, finished: 50 }),
      ]);
      const scoped = chatDescendants(all.threads, root);
      setChildren(scoped);
      setJobs(commands);
      setError(false);
      data.set((s) => ({ threads: { ...s.threads, ...Object.fromEntries(scoped.map((th) => [th.id, th])) } }));
    } catch {
      setError(true);
    }
  }, [root]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (connection === "online") void refresh();
    const stop = watchEvents((ev) => {
      if (!["thread.updated", "thread.deleted", "run.updated", "job.updated"].includes(ev.type) || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 400);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [refresh, connection]);
  useEffect(() => {
    if (selected && loadState == null) void loadThread(selected);
  }, [selected, loadState]);
  const active = (children ?? []).map((th) => threads[th.id] ?? th).filter((th) => going(th.state));
  const done = (children ?? []).map((th) => threads[th.id] ?? th).filter((th) => !going(th.state));
  const row = (th: Thread) => {
    const agent = threadAgent(th, agents);
    return (
      <button key={th.id} type="button" className="processes__row" onClick={() => go.subthread(th.id)}>
        <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={28} animated={isWorking(th.state)} />
        <span className="processes__name">{th.title}</span>
        <span className="processes__status">
          {th.state === "input-required"
            ? t("run.waiting")
            : th.state === "queued"
              ? t("run.queued")
              : isWorking(th.state)
                ? t("run.working")
                : th.state === "failed"
                  ? t("run.failed")
                  : t("run.done")}
        </span>
      </button>
    );
  };
  return (
    <>
      <PanelHeader
        actions={
          selected && (
            <IconButton
              label={t("processes.maximize")}
              icon={<Icons.Maximize2 size={14} />}
              onClick={() => {
                go.thread(selected);
                go.panel(null);
              }}
            />
          )
        }
      >
        {selected && (
          <IconButton label={t("processes.back")} icon={<Icons.ArrowLeft size={14} />} onClick={go.processes} />
        )}
        <span className="sidepanel__title">
          <Icons.Users size={14} />
          {selected ? (thread?.title ?? t("thread.a2a")) : t("panel.processes")}
        </span>
      </PanelHeader>
      {selected ? (
        loadState === "error" || (loadState === "ready" && !thread) ? (
          <EmptyState icon={<Icons.TriangleAlert />} title={t("chat.notFound.title")} />
        ) : thread && loadState === "ready" ? (
          <>
            <Transcript key={selected} thread={thread} />
            <div className="chat__readonly">{t("chat.readOnly")}</div>
          </>
        ) : (
          <Skeleton className="term__loading" />
        )
      ) : (
        <div className="sidepanel__body processes">
          {error ? (
            <p className="running__empty">
              {t("processes.failed")}
              <button type="button" className="term__link" onClick={() => void refresh()}>
                {t("common.retry")}
              </button>
            </p>
          ) : !children ? (
            <Skeleton className="term__loading" />
          ) : (
            <>
              <h3 className="processes__heading">{t("processes.active", { n: active.length })}</h3>
              {active.map(row)}
              {!active.length && <p className="running__empty">{t("running.empty")}</p>}
              <h3 className="processes__heading">{t("processes.done", { n: done.length })}</h3>
              {done.map(row)}
              {!done.length && <p className="running__empty">{t("processes.empty")}</p>}
              <h3 className="processes__heading">{t("panel.terminal")}</h3>
              <JobList
                running={jobs.running}
                finished={jobs.finished}
                now={now}
                onOpen={(job) => (job.thread_id === root ? go.panel("terminal") : go.subthread(job.thread_id))}
              />
            </>
          )}
        </div>
      )}
    </>
  );
}
