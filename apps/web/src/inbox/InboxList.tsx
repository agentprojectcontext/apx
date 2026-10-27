import {
  Button,
  EmptyState,
  IconButton,
  Icons,
  Menu,
  ProjectTile,
  SearchField,
  SegmentedControl,
  Skeleton,
} from "@apx/ui";
import { Suspense, useMemo, useState } from "react";
import { markAllRead } from "../data/actions.ts";
import { DEFAULT_PID, findProject, projectInitial, projectTone, threadAgent } from "../data/identity.ts";
import { type InboxView, setPrefs, usePrefs } from "../data/prefs.ts";
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
  unreadListed,
} from "./groupThreads.ts";
import { TreeView } from "./InboxViews.tsx";
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
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showArchived, setShowArchived] = useState(false);
  const chatAgents = useChatAgents(projectId);

  const view = usePrefs((s) => s.inboxView);
  const routines = usePrefs((s) => s.inboxRoutines);
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
  // The chats the Inbox counts as unread, in this project when one is open.
  const unreadIds = useMemo(() => unreadListed(threads, { projectId, routines }), [threads, routines, projectId]);
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
            label={t("inbox.markAllRead")}
            icon={<Icons.CheckCheck size={16} />}
            disabled={unreadIds.length === 0}
            onClick={() => void markAllRead(unreadIds)}
          />
          <Menu
            align="end"
            trigger={<IconButton label={t("inbox.filter")} icon={<Icons.Filter size={16} />} active={!routines} />}
            items={[
              { type: "label", label: t("inbox.filter.show") },
              {
                label: t("inbox.filter.routines"),
                icon: <Icons.Clock size={14} />,
                checked: routines,
                onSelect: () => setPrefs({ inboxRoutines: !routines }),
              },
            ]}
          />
          <NewChatMenu
            projectId={projectId}
            trigger={<IconButton label={t("chat.new")} icon={<Icons.SquarePen size={16} />} disabled={!ready} />}
          />
        </div>
        <SegmentedControl
          size="sm"
          className="inbox__views"
          label={t("inbox.view")}
          value={view}
          onValueChange={(v) => setPrefs({ inboxView: v as InboxView })}
          options={[
            { value: "tree", label: t("inbox.view.tree") },
            { value: "activity", label: t("inbox.view.activity") },
            { value: "chats", label: t("inbox.view.chats") },
          ]}
        />
        <SearchField
          size="sm"
          placeholder={t("inbox.search")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
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
        {ready && archived.length > 0 && (
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
