import { Button, EmptyState, IconButton, Icons, ProjectTile, SearchField, SegmentedControl, Skeleton } from "@apx/ui";
import { useMemo, useState } from "react";
import { DEFAULT_PID, findProject, projectInitial, projectTone, threadAgent } from "../data/identity.ts";
import { type InboxView, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { FoldList } from "../shell/ListColumn.tsx";
import { go, useNav } from "../shell/nav.ts";
import { groupByAgent, groupByProject, groupByTime } from "./groupThreads.ts";
import { ActivityView, TreeView } from "./InboxViews.tsx";
import { NewChatMenu, startChat, useChatAgents } from "./NewChatMenu.tsx";
import { ThreadRow } from "./ThreadRow.tsx";

/** Chat list: every chat grouped by project (Inbox), or one project's chats (project › Chats). */
export function InboxList() {
  const t = useT();
  const projectId = useNav((s) => (s.view === "project" ? s.projectId : undefined));
  const threadId = useNav((s) => s.threadId);
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const offline = useData((s) => s.connection === "offline");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);
  const chatAgents = useChatAgents(projectId);

  const view = usePrefs((s) => s.inboxView);
  const groups = useMemo(
    () => groupByProject(threads, projects, { projectId, query }),
    [threads, projects, projectId, query],
  );
  const trees = useMemo(
    () => (view === "tree" ? groupByAgent(threads, projects, { projectId, query }) : []),
    [view, threads, projects, projectId, query],
  );
  const activity = useMemo(
    () => (view === "activity" ? groupByTime(threads, { projectId, query }) : []),
    [view, threads, projectId, query],
  );
  const title = projectId
    ? t("inbox.projectChats", { project: findProject(projects, projectId)?.name ?? t("project.fallback") })
    : t("nav.inbox");

  const newChat = async () => {
    const first = chatAgents[0];
    if (!first) return;
    setCreating(true);
    await startChat(first, projectId);
    setCreating(false);
  };

  return (
    <section className="inbox" aria-label={title}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <h1 className="inbox__title">{title}</h1>
          <FoldList />
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
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Icons.Inbox />}
            title={query ? t("inbox.noResults") : t("inbox.empty")}
            action={
              !query && (
                <Button size="sm" onClick={newChat} loading={creating}>
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
          <ActivityView groups={activity} selected={threadId} />
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
                  g.threads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      agent={threadAgent(t, agents)}
                      selected={t.id === threadId}
                      onOpen={() => go.thread(t.id)}
                    />
                  ))}
              </div>
            );
          })
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
