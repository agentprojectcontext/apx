import type { Thread } from "@apx/protocol";
import { ConversationRow, Icons, Spinner } from "@apx/ui";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import { shortWhen } from "../common/format.ts";
import { DEFAULT_PID, isWorking, projectName, routineName, threadAgent } from "../data/identity.ts";
import { loadRoutines, useRoutines } from "../data/routines.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { CallBundle, ChannelBundle, InboxTasks } from "../lazy.ts";
import { scheduleText } from "../routines/scheduleText.ts";
import { go, useNav } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import { bundleChats, type ListEntry } from "./groupThreads.ts";
import { TasksSkeleton } from "./InboxSkeleton.tsx";
import { ProjectBadge } from "./ProjectBadge.tsx";
import { selectionPath } from "./selectionPath.ts";
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
  reveal = false,
  children,
}: {
  label: string;
  count?: number;
  foldKey?: string;
  /** The chat on screen is inside: it opens. */
  reveal?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useOpenRow(foldKey ?? "", reveal);
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

/**
 * Chats: pinned ones, then the rest by their last message; archived ones under a fold. The calls go under one Calls
 * row; with `byChannel`, the rest's chats on each channel account go under one row too.
 */
export function ChatsTab({
  entries,
  archived,
  byChannel = false,
  account = false,
  tail,
}: {
  entries: Thread[];
  archived: Thread[];
  byChannel?: boolean;
  /** The list is one channel account's: its rows say what was written and who answers, not where. */
  account?: boolean;
  /** Rows after the recent chats (an account's contacts with no chat yet). */
  tail?: ReactNode;
}) {
  const t = useT();
  const selected = useNav((s) => s.threadId);
  const loaded = useData((s) => s.threads);
  // The chat on screen, or one it delegated, opens the Archived fold it sits in.
  const archivedOpen = useMemo(() => {
    const path = selectionPath(loaded, selected);
    return archived.some((th) => path.has(th.id));
  }, [loaded, selected, archived]);
  const pinned = entries.filter((th) => th.pinned);
  const rest = entries.filter((th) => !th.pinned);
  const row = (th: Thread) => <ChatRow key={th.id} thread={th} selected={selected} account={account} />;
  const recent = bundleChats(rest, byChannel).map((e) =>
    e.kind === "thread" ? (
      row(e.thread)
    ) : e.kind === "calls" ? (
      <Suspense key="calls" fallback={null}>
        <CallBundle threads={e.threads} selected={selected} />
      </Suspense>
    ) : (
      <Suspense key={`channel:${e.account}`} fallback={null}>
        <ChannelBundle account={e.account} threads={e.threads} selected={selected} />
      </Suspense>
    ),
  );
  return (
    <>
      {pinned.length > 0 && <InboxSection label={t("inbox.pinned")}>{pinned.map(row)}</InboxSection>}
      {pinned.length > 0 ? (
        <InboxSection label={t("inbox.recent")}>
          {recent}
          {tail}
        </InboxSection>
      ) : (
        <>
          {recent}
          {tail}
        </>
      )}
      {archived.length > 0 && (
        <InboxSection
          label={t("inbox.archived")}
          count={archived.length}
          foldKey="section:archived"
          reveal={archivedOpen}
        >
          {archived.map(row)}
        </InboxSection>
      )}
    </>
  );
}

export function ChatRow({
  thread,
  selected,
  account = false,
  bundled = false,
}: {
  thread: Thread;
  selected: string | undefined;
  account?: boolean;
  bundled?: boolean;
}) {
  const agents = useShownAgents();
  return (
    <ListedChat thread={thread} selected={selected} inline>
      <ThreadRow
        thread={thread}
        agent={threadAgent(thread, agents)}
        selected={thread.id === selected}
        account={account}
        bundled={bundled}
        onOpen={() => go.thread(thread.id)}
      />
    </ListedChat>
  );
}

/** Tasks in their status sections, in the owner's order; sketched while they load, never an empty list. */
export function TasksTab({ entries }: { entries: Tasks[] }) {
  return (
    <Suspense fallback={<TasksSkeleton />}>
      <InboxTasks entries={entries} />
    </Suspense>
  );
}

/** Routines: one row each; it opens the routine's runs as one chat. */
export function RoutinesTab({ entries }: { entries: Routines[] }) {
  useEffect(() => {
    void loadRoutines();
  }, []);
  return (
    <>
      {entries.map((e) => (
        <RoutineChatRow key={e.routineId} routineId={e.routineId} runs={e.threads} />
      ))}
    </>
  );
}

function RoutineChatRow({ routineId, runs }: { routineId: string; runs: Thread[] }) {
  const t = useT();
  const agents = useShownAgents();
  const current = useNav((s) => s.routineId);
  const openThread = useNav((s) => s.threadId);
  const routine = useRoutines((s) => s.routines.find((r) => r.id === routineId));
  const projects = useData((s) => s.projects);
  const latest = useMemo(() => runs.reduce((a, b) => (a.updated_at >= b.updated_at ? a : b)), [runs]);
  const unread = runs.reduce((n, th) => n + th.unread, 0);
  const working = runs.some((th) => isWorking(th.state));
  const failed = latest.state === "failed";
  // What its runs did, not whether it is on: the latest run's outcome, or running now.
  const state = working ? "is-running" : failed ? "is-failed" : "";
  return (
    <ConversationRow
      className="threadrow routinerow"
      // One of its runs opened on its own (a notice, a link) is this row too.
      selected={current === routineId || runs.some((th) => th.id === openThread)}
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
              {working ? t("routines.state.running") : failed ? t("routines.state.failed") : t("routines.state.done")}
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
