import type { Thread } from "@apx/protocol";
import { ConversationRow, Icons, Spinner } from "@apx/ui";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { DEFAULT_PID, isWorking, projectName, routineName, threadAgent } from "../data/identity.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { TaskBundle } from "../lazy.ts";
import { scheduleText } from "../routines/Schedule.tsx";
import { go, useNav } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import type { ListEntry } from "./groupThreads.ts";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { ThreadAvatar } from "./ThreadAvatar.tsx";
import { ThreadRow } from "./ThreadRow.tsx";
import { useOpenRow } from "./useOpenRow.ts";

type Routines = Extract<ListEntry, { kind: "routine" }>;
type Tasks = Extract<ListEntry, { kind: "task" }>;

/** A labelled part of the Inbox; with `foldKey` it folds, closed until the owner opens it (remembered). */
function InboxSection({
  label,
  count,
  foldKey,
  children,
}: {
  label: string;
  count?: number;
  foldKey?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useOpenRow(foldKey ?? "", false);
  if (!foldKey)
    return (
      <div className="inboxsec">
        <div className="inboxsec__head">{label}</div>
        {children}
      </div>
    );
  return (
    <div className="inboxsec">
      <ConversationRow
        className="inboxsec__toggle"
        avatar={open ? <Icons.ChevronDown size={12} /> : <Icons.ChevronRight size={12} />}
        title={label}
        time={count}
        onClick={() => setOpen(!open)}
      />
      {open && children}
    </div>
  );
}

/** Chats: pinned ones, then the rest by their last message; archived ones under a fold. */
export function ChatsTab({ entries, archived }: { entries: Thread[]; archived: Thread[] }) {
  const t = useT();
  const selected = useNav((s) => s.threadId);
  const pinned = entries.filter((th) => th.pinned);
  const rest = entries.filter((th) => !th.pinned);
  const row = (th: Thread) => <ChatRow key={th.id} thread={th} selected={selected} />;
  return (
    <>
      {pinned.length > 0 && <InboxSection label={t("inbox.pinned")}>{pinned.map(row)}</InboxSection>}
      {pinned.length > 0 ? <InboxSection label={t("inbox.recent")}>{rest.map(row)}</InboxSection> : rest.map(row)}
      {archived.length > 0 && (
        <InboxSection label={t("inbox.archived")} count={archived.length} foldKey="section:archived">
          {archived.map(row)}
        </InboxSection>
      )}
    </>
  );
}

function ChatRow({ thread, selected }: { thread: Thread; selected: string | undefined }) {
  const agents = useShownAgents();
  return (
    <ListedChat thread={thread} selected={selected} inline>
      <ThreadRow
        thread={thread}
        agent={threadAgent(thread, agents)}
        selected={thread.id === selected}
        onOpen={() => go.thread(thread.id)}
      />
    </ListedChat>
  );
}

/** Tasks: one row each, its agents' chats under it once opened. */
export function TasksTab({ entries }: { entries: Tasks[] }) {
  const selected = useNav((s) => s.threadId);
  return (
    <>
      {entries.map((e) => (
        <Suspense key={e.taskId} fallback={null}>
          <TaskBundle taskId={e.taskId} threads={e.threads} selected={selected} />
        </Suspense>
      ))}
    </>
  );
}

/** Routines: one row each; it opens the routine's runs as one chat. Turned-off ones wait under a fold. */
export function RoutinesTab({ entries }: { entries: Routines[] }) {
  const t = useT();
  const routines = useRoutines((s) => s.routines);
  useEffect(() => {
    void loadRoutines();
  }, []);
  const off = new Set(routines.filter((r) => !r.enabled).map((r) => r.id));
  const row = (e: Routines) => <RoutineChatRow key={e.routineId} routineId={e.routineId} runs={e.threads} />;
  const asleep = entries.filter((e) => off.has(e.routineId));
  if (asleep.length === entries.length) return <>{entries.map(row)}</>;
  return (
    <>
      {entries.filter((e) => !off.has(e.routineId)).map(row)}
      {asleep.length > 0 && (
        <InboxSection label={t("routines.offMany")} count={asleep.length} foldKey="section:routinesOff">
          {asleep.map(row)}
        </InboxSection>
      )}
    </>
  );
}

function RoutineChatRow({ routineId, runs }: { routineId: string; runs: Thread[] }) {
  const t = useT();
  const agents = useShownAgents();
  const current = useNav((s) => s.routineId);
  const routine = useRoutines((s) => s.routines.find((r) => r.id === routineId));
  const projects = useData((s) => s.projects);
  const latest = useMemo(() => runs.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b)), [runs]);
  const unread = runs.reduce((n, th) => n + th.unread, 0);
  const working = runs.some((th) => isWorking(th.state));
  const failed = latest.state === "failed";
  const off = routine && !routine.enabled;
  const state = off ? "is-off" : working ? "is-running" : failed ? "is-failed" : "";
  return (
    <ConversationRow
      className="threadrow routinerow"
      selected={current === routineId}
      onClick={() => go.routine(routineId)}
      avatar={<ThreadAvatar thread={latest} agent={threadAgent(latest, agents)} size={24} slot={28} />}
      title={routine?.name ?? routineName(latest)}
      time={shortWhen(latest.updated_at)}
      unread={unread}
      preview={
        <span className="threadrow__line">
          <span className="threadrow__who">
            <span className={`routinerow__state ${state}`}>
              <span className="routinerow__dot" />
              {off
                ? t("routines.off")
                : working
                  ? t("routines.state.running")
                  : failed
                    ? t("routines.state.failed")
                    : t("routines.state.done")}
            </span>
            {" · "}
            <Icons.RefreshCw size={12} className="routinerow__runs" /> {runs.length}
            {routine && ` · ${scheduleText(routine.schedule, t)}`}
          </span>
          <span className="threadrow__dot">·</span>
          <ProjectBadge id={latest.project_id ?? DEFAULT_PID} name={projectName(projects, latest.project_id)} />
        </span>
      }
      titleTag={working && <Spinner size={12} className="threadrow__spin" />}
    />
  );
}
