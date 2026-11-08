import type { Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, ProjectTile, SearchField, SegmentedControl, Skeleton } from "@apx/ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { DEFAULT_PID, findProject, projectInitial, projectTone, threadAgent } from "../data/identity.ts";
import { type InboxTab, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData, useShownAgents } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ActivityView, TaskBundle } from "../lazy.ts";
import { go, useNav } from "../shell/nav.ts";
import { ListedChat } from "./Delegated.tsx";
import {
  archivedThreads,
  bundleTasks,
  groupByAgent,
  groupByProject,
  groupByTime,
  inboxEntries,
} from "./groupThreads.ts";
import { InboxFilterChips, InboxFilterMenu } from "./InboxFilterMenu.tsx";
import { ChatsTab, RoutinesTab, TasksTab } from "./InboxTabs.tsx";
import { TreeView } from "./InboxViews.tsx";
import { passesFilter, useInboxFilter } from "./inboxFilter.ts";
import { NewChatMenu, startChat, useChatAgents } from "./NewChatMenu.tsx";
import { RoutineBundle } from "./RoutineBundle.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

/** Chat list: every chat grouped by project (Inbox), or one project's chats (project › Chats). */
export function InboxList() {
  const t = useT();
  const projectId = useNav((s) => (s.view === "project" ? s.projectId : undefined));
  const threadId = useNav((s) => s.threadId);
  const threads = useData((s) => s.threads);
  const agents = useShownAgents();
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const offline = useData((s) => s.connection === "offline");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const filter = useInboxFilter((s) => s);
  const filtered = filter.agents.length + filter.projects.length > 0;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const chatAgents = useChatAgents(projectId);

  const view = usePrefs((s) => s.inboxView);
  const tab = usePrefs((s) => s.inboxTab);
  const routineOpen = useNav((s) => s.routineId != null);
  // A routine's runs open as one chat: its row is in Routines, however it was opened (a row, a link, back).
  useEffect(() => {
    if (routineOpen) setPrefs({ inboxTab: "routines" });
  }, [routineOpen]);
  const routines = usePrefs((s) => s.inboxRoutines);
  const entries = useMemo(
    () => inboxEntries(threads, { projectId, query, routines: true }),
    [threads, projectId, query],
  );
  const allListed = useMemo(() => entries.flatMap((e) => (e.kind === "thread" ? [e.thread] : e.threads)), [entries]);
  const tabs = useMemo(() => {
    const ok = (th: Thread) => passesFilter(th, filter, projects);
    return {
      chats: entries.flatMap((e) => (e.kind === "thread" && ok(e.thread) ? [e.thread] : [])),
      tasks: entries.flatMap((e) => (e.kind === "task" && e.threads.some(ok) ? [e] : [])),
      routines: entries.flatMap((e) => (e.kind === "routine" && e.threads.some(ok) ? [e] : [])),
    };
  }, [entries, filter, projects]);
  const groups = useMemo(
    () => groupByProject(threads, projects, { projectId, query, routines }),
    [threads, projects, projectId, query, routines],
  );
  const trees = useMemo(
    () => (view === "tree" ? groupByAgent(threads, projects, { projectId, query, routines }) : []),
    [view, threads, projects, projectId, query, routines],
  );
  const activity = useMemo(
    () => (view === "activity" ? groupByTime(threads, { projectId, query, routines }) : []),
    [view, threads, projectId, query, routines],
  );
  const archived = useMemo(() => archivedThreads(threads, { projectId, query }), [threads, projectId, query]);
  const title = projectId
    ? t("inbox.projectChats", { project: findProject(projects, projectId)?.name ?? t("project.fallback") })
    : t("nav.inbox");

  const newChat = () => {
    const first = chatAgents[0];
    if (first) startChat(first, projectId);
  };

  return (
    <section className="inbox" aria-label={title}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <h1 className="inbox__title">{title}</h1>
          <IconButton
            label={t("inbox.searchOpen")}
            active={searching}
            icon={<Icons.Search size={16} />}
            onClick={() => {
              if (searching) setQuery("");
              setSearching(!searching);
            }}
          />
          <NewChatMenu
            projectId={projectId}
            trigger={<IconButton label={t("chat.new")} icon={<Icons.SquarePen size={16} />} disabled={!ready} />}
          />
          <InboxFilterMenu threads={allListed} />
        </div>
        <SegmentedControl
          size="sm"
          className="inbox__views"
          label={t("inbox.tabs")}
          value={tab}
          onValueChange={(v) => setPrefs({ inboxTab: v as InboxTab })}
          options={(["chats", "tasks", "routines"] as const).map((v) => ({
            value: v,
            label: (
              <>
                {t(`inbox.tab.${v}`)}
                <span className="inbox__tabcount">{tabs[v].length}</span>
              </>
            ),
          }))}
        />
        <InboxFilterChips />
        {searching && (
          <SearchField
            size="sm"
            autoFocus
            placeholder={t("inbox.search")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setQuery("");
              setSearching(false);
            }}
          />
        )}
      </div>
      <div className="inbox__list">
        {!ready && offline ? (
          <EmptyState icon={<Icons.WifiOff />} title={t("inbox.offline.title")}>
            {t("inbox.offline.body")}
          </EmptyState>
        ) : !ready ? (
          <InboxSkeleton />
        ) : groups.length === 0 && archived.length === 0 ? (
          <EmptyState
            icon={<Icons.Inbox />}
            title={query ? t("inbox.noResults") : t("inbox.empty")}
            action={
              !query && (
                <Button size="sm" onClick={newChat}>
                  {t("chat.new")}
                </Button>
              )
            }
          >
            {query ? t("inbox.noMatch", { query }) : t("inbox.emptyBody")}
          </EmptyState>
        ) : tab === "tasks" ? (
          tabs.tasks.length ? (
            <TasksTab entries={tabs.tasks} />
          ) : (
            <EmptyState
              icon={<Icons.ListChecks />}
              title={filtered ? t("inbox.filter.none") : t("inbox.tabEmpty.tasks")}
            />
          )
        ) : tab === "routines" ? (
          tabs.routines.length ? (
            <RoutinesTab entries={tabs.routines} />
          ) : (
            <EmptyState
              icon={<Icons.Clock />}
              title={filtered ? t("inbox.filter.none") : t("inbox.tabEmpty.routines")}
            />
          )
        ) : view === "list" ? (
          <ChatsTab entries={tabs.chats} archived={archived} />
        ) : view === "tree" ? (
          <TreeView trees={trees} selected={threadId} />
        ) : view === "activity" ? (
          <Suspense fallback={<InboxSkeleton />}>
            <ActivityView groups={activity} selected={threadId} />
          </Suspense>
        ) : (
          groups.map((g) => {
            const isCollapsed = collapsed[g.key] ?? false;
            return (
              <div key={g.key} className="inbox__group">
                <button
                  type="button"
                  className="inbox__grouphead"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                >
                  <ProjectTile
                    tone={projectTone(g.project?.id ?? DEFAULT_PID)}
                    initial={projectInitial(g.name)}
                    size={16}
                  />
                  <span className="inbox__groupname">{g.name}</span>
                  <span className="inbox__groupcount">{g.threads.length}</span>
                  {g.running > 0 && (
                    <span className="inbox__grouprun">{t("inbox.groupRunning", { n: g.running })}</span>
                  )}
                  <span className="inbox__groupspacer" />
                  {isCollapsed ? <Icons.ChevronRight size={14} /> : <Icons.ChevronDown size={14} />}
                </button>
                {!isCollapsed &&
                  bundleTasks(g.threads).map((entry) =>
                    entry.kind === "routine" ? (
                      <RoutineBundle
                        key={`routine:${entry.routineId}`}
                        routineId={entry.routineId}
                        threads={entry.threads}
                        selected={threadId}
                      />
                    ) : entry.kind === "task" ? (
                      <Suspense key={entry.taskId} fallback={null}>
                        <TaskBundle taskId={entry.taskId} threads={entry.threads} selected={threadId} />
                      </Suspense>
                    ) : (
                      <ListedChat key={entry.thread.id} thread={entry.thread} selected={threadId}>
                        <ThreadRow
                          thread={entry.thread}
                          agent={threadAgent(entry.thread, agents)}
                          selected={entry.thread.id === threadId}
                          onOpen={() => go.thread(entry.thread.id)}
                        />
                      </ListedChat>
                    ),
                  )}
              </div>
            );
          })
        )}
        {ready && tab === "chats" && view !== "list" && archived.length > 0 && (
          <div className="inbox__archived">
            <button
              type="button"
              className="inbox__grouphead"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((v) => !v)}
            >
              <Icons.Archive size={14} />
              <span className="inbox__groupname">{t("inbox.archived")}</span>
              <span className="inbox__groupcount">{archived.length}</span>
              <span className="inbox__groupspacer" />
              {showArchived ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
            </button>
            {showArchived &&
              archived.map((th) => (
                <ThreadRow
                  key={th.id}
                  thread={th}
                  agent={threadAgent(th, agents)}
                  selected={th.id === threadId}
                  onOpen={() => go.thread(th.id)}
                />
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

function InboxSkeleton() {
  return (
    <div className="inbox__skeleton" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="inbox__skelrow">
          <Skeleton shape="circle" width={36} />
          <div className="inbox__skeltext">
            <Skeleton width="60%" />
            <Skeleton width="85%" />
          </div>
        </div>
      ))}
    </div>
  );
}
