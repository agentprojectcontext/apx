import type { Thread } from "@apx/protocol";
import { AgentAvatar, Button, EmptyState, IconButton, Icons, Skeleton, Spinner } from "@apx/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Transcript } from "../chat/Transcript.tsx";
import { shortWhen } from "../common/format.ts";
import { useNow } from "../common/useNow.ts";
import { loadThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { blobOf, isWorking, threadAgent } from "../data/identity.ts";
import { queuedTurnsOf } from "../data/jobs.ts";
import { watchEvents } from "../data/live.ts";
import { data, useData } from "../data/state.ts";
import { type T, useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { QueuedTurns } from "../shell/QueuedTurns.tsx";
import { closeTab, useOpenTabs } from "./openTabs.ts";
import { LIST_TAB, PanelGroup, PanelList, PanelRow, PanelTabs } from "./PanelTabs.tsx";
import { chatDescendants } from "./process-scope.ts";
import { PanelHeader } from "./SidePanel.tsx";

/** Not over yet: working, waiting on the owner, or waiting for a free delegation slot. */
const going = (state: Thread["state"]) => isWorking(state) || state === "input-required" || state === "queued";

const statusOf = (t: T, state: Thread["state"]) =>
  state === "input-required"
    ? t("run.waiting")
    : state === "queued"
      ? t("run.queued")
      : isWorking(state)
        ? t("agentsPanel.going")
        : state === "failed"
          ? t("run.failed")
          : t("run.done");

/**
 * The agents this chat called: its own turn and those queued behind it, then each conversation it (or an agent it
 * called) handed to another agent, opened as a tab beside the chat's transcript.
 */
export function AgentsPanel() {
  const t = useT();
  const root = useNav((s) => s.threadId);
  const selected = useNav((s) => (s.panelParent === root ? s.panelThread : undefined));
  const thread = useData((s) => (selected ? s.threads[selected] : undefined));
  const loadState = useData((s) => (selected ? s.threadLoad[selected] : undefined));
  const agents = useData((s) => s.agents);
  const threads = useData((s) => s.threads);
  const connection = useData((s) => s.connection);
  const rootThread = useData((s) => (root ? s.threads[root] : undefined));
  const allJobs = useData((s) => s.jobs.running);
  const queued = useMemo(() => (root ? queuedTurnsOf(allJobs, root) : []), [allJobs, root]);
  const [children, setChildren] = useState<Thread[]>();
  const [error, setError] = useState(false);
  const now = useNow(true);
  const refresh = useCallback(async () => {
    if (!root) return;
    try {
      const all = await client.call("threads.list", {
        root_thread: root,
        include_subthreads: true,
        include_archived: true,
      });
      const scoped = chatDescendants(all.threads, root);
      setChildren(scoped);
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
      if (!["thread.updated", "thread.deleted", "run.updated"].includes(ev.type) || timer) return;
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
  const current = (children ?? []).map((th) => threads[th.id] ?? th);
  const active = current.filter((th) => going(th.state));
  const done = current.filter((th) => !going(th.state));
  const own = rootThread && going(rootThread.state) ? rootThread : undefined;
  const ownAgent = own && threadAgent(own, agents);
  const activeCount = (own ? 1 : 0) + queued.length + active.length;
  const key = root && `agents:${root}`;
  const open = useOpenTabs(key, selected);
  const tabs = open.flatMap((id) => {
    const th = threads[id] ?? children?.find((x) => x.id === id);
    return th
      ? [{ id, label: th.title || t("thread.a2a"), dot: going(th.state) ? ("busy" as const) : ("idle" as const) }]
      : [];
  });
  /** "Roby → Fausto: task": who asked, who works on it and what (delegated chats are titled so already). */
  const titleOf = (th: Thread) => {
    if (th.title.includes(" → ")) return th.title;
    const callee = threadAgent(th, agents);
    const parent = th.parent_id ? threads[th.parent_id] : undefined;
    const caller = parent && threadAgent(parent, agents);
    const pair = caller && callee && caller.id !== callee.id ? `${caller.name} → ${callee.name}` : callee?.name;
    return pair ? `${pair}: ${th.title}` : th.title;
  };
  const row = (th: Thread) => {
    const agent = threadAgent(th, agents);
    return (
      <PanelRow
        key={th.id}
        className="agents__row"
        leading={
          <AgentAvatar name={agent?.name ?? th.title} blob={blobOf(agent)} size={20} animated={isWorking(th.state)} />
        }
        title={titleOf(th)}
        description={
          <span className={th.state === "failed" ? "agents__state is-failed" : "agents__state"}>
            {statusOf(t, th.state)}
          </span>
        }
        trailing={
          <span className="agents__when">
            {isWorking(th.state) && <Spinner size={12} />}
            {shortWhen(th.updated_at)}
          </span>
        }
        onClick={() => go.subthread(th.id)}
      />
    );
  };
  return (
    <>
      <PanelHeader
        kind="agents"
        actions={
          selected && (
            <IconButton
              label={t("processes.maximize")}
              icon={<Icons.ExternalLink size={14} />}
              onClick={() => {
                go.thread(selected);
                go.panel(null);
              }}
            />
          )
        }
      />
      <PanelTabs
        label={t("panel.agents")}
        list={t("panelTabs.all", { n: activeCount + done.length })}
        tabs={tabs}
        value={selected ?? LIST_TAB}
        onSelect={(id) => (id === LIST_TAB ? go.agents() : go.subthread(id))}
        onClose={(id) => {
          if (key) closeTab(key, id);
          if (id === selected) go.agents();
        }}
      />
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
      ) : error ? (
        <div className="sidepanel__body">
          <EmptyState
            icon={<Icons.TriangleAlert />}
            title={t("agentsPanel.failed")}
            action={
              <Button size="sm" variant="secondary" onClick={() => void refresh()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : !children ? (
        <Skeleton className="term__loading" />
      ) : (
        <PanelList label={t("panel.agents")}>
          <PanelGroup title={t("processes.active", { n: activeCount })} />
          {own && (
            <div className="apx-pickrow agents__row is-own">
              <span className="apx-pickrow__lead">
                <AgentAvatar
                  name={ownAgent?.name ?? own.title}
                  blob={blobOf(ownAgent)}
                  size={20}
                  animated={isWorking(own.state)}
                />
              </span>
              <span className="apx-pickrow__main">
                <span className="apx-pickrow__title">{ownAgent?.name ?? own.title}</span>
                <span className="apx-pickrow__desc">{statusOf(t, own.state)}</span>
              </span>
              {isWorking(own.state) && (
                <span className="apx-pickrow__trail">
                  <Spinner size={12} />
                </span>
              )}
            </div>
          )}
          <QueuedTurns turns={queued} now={now} />
          {active.map(row)}
          {!activeCount && <p className="plist__empty">{t("running.empty")}</p>}
          <PanelGroup title={t("processes.done", { n: done.length })} />
          {done.map(row)}
          {!current.length && <p className="plist__empty">{t("agentsPanel.empty")}</p>}
        </PanelList>
      )}
    </>
  );
}
