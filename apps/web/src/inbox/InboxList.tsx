import type { Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, SearchField, SegmentedControl, Skeleton } from "@apx/ui";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useChannels } from "../data/channels.ts";
import { findProject } from "../data/identity.ts";
import { type InboxTab, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountHeader } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import { archivedThreads, inboxEntries } from "./groupThreads.ts";
import { InboxFilterChips, InboxFilterMenu } from "./InboxFilterMenu.tsx";
import { ChatsTab, RoutinesTab, TasksTab } from "./InboxTabs.tsx";
import { filterCount, passesFilter, soleFilter, useInboxFilter } from "./inboxFilter.ts";
import { NewChatMenu, startChat, useChatAgents } from "./NewChatMenu.tsx";

/** Chat list: every chat grouped by project (Inbox), or one project's chats (project › Chats). */
export function InboxList() {
  const t = useT();
  const projectId = useNav((s) => (s.view === "project" ? s.projectId : undefined));
  const threads = useData((s) => s.threads);
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const offline = useData((s) => s.connection === "offline");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const filter = useInboxFilter((s) => s);
  const filtered = filterCount(filter) > 0;
  const channels = useChannels((s) => s.channels);
  // Narrowed to one channel account, the Inbox is that account's: its header, its chats.
  const sole = soleFilter(filter);
  const account = !projectId && sole?.kind === "accounts" ? channels.find((c) => c.id === sole.id) : undefined;
  const chatAgents = useChatAgents(projectId);

  const savedTab = usePrefs((s) => s.inboxTab);
  const tab: InboxTab = account ? "chats" : savedTab;
  const routineOpen = useNav((s) => s.routineId != null);
  // A routine's runs open as one chat: its row is in Routines, however it was opened (a row, a link, back).
  useEffect(() => {
    if (routineOpen) setPrefs({ inboxTab: "routines" });
  }, [routineOpen]);
  const entries = useMemo(
    () => inboxEntries(threads, { projectId, query, routines: true }),
    [threads, projectId, query],
  );
  const allListed = useMemo(() => entries.flatMap((e) => (e.kind === "thread" ? [e.thread] : e.threads)), [entries]);
  const tabs = useMemo(() => {
    const kindOf = (id: string) => channels.find((c) => c.id === id)?.type;
    const ok = (th: Thread) => passesFilter(th, filter, projects, kindOf);
    return {
      chats: entries.flatMap((e) => (e.kind === "thread" && ok(e.thread) ? [e.thread] : [])),
      tasks: entries.flatMap((e) => (e.kind === "task" && e.threads.some(ok) ? [e] : [])),
      routines: entries.flatMap((e) => (e.kind === "routine" && e.threads.some(ok) ? [e] : [])),
    };
  }, [entries, filter, projects, channels]);
  const archived = useMemo(() => archivedThreads(threads, { projectId, query }), [threads, projectId, query]);
  const title = projectId
    ? t("inbox.projectChats", { project: findProject(projects, projectId)?.name ?? t("project.fallback") })
    : t("nav.inbox");

  const closeSearch = () => {
    setQuery("");
    setSearching(false);
  };

  const newChat = () => {
    const first = chatAgents[0];
    if (first) startChat(first, projectId);
  };

  return (
    <section className="inbox" aria-label={title}>
      <div className="inbox__head">
        {account ? (
          <Suspense fallback={<h1 className="inbox__title">{account.label}</h1>}>
            <AccountHeader account={account} />
          </Suspense>
        ) : (
          <>
            <div className="inbox__titlerow">
              <h1 className="inbox__title">{title}</h1>
              <NewChatMenu
                projectId={projectId}
                side="bottom"
                align="start"
                trigger={
                  <IconButton size="sm" label={t("chat.new")} icon={<Icons.SquarePen size={15} />} disabled={!ready} />
                }
              />
              <span className="inbox__headsep" aria-hidden="true" />
              <IconButton
                size="sm"
                label={t("inbox.searchOpen")}
                active={searching}
                icon={<Icons.Search size={15} />}
                // The field keeps focus on press: its blur would close an empty search and this click open it again.
                onMouseDown={(e) => searching && e.preventDefault()}
                onClick={() => (searching ? closeSearch() : setSearching(true))}
              />
              <InboxFilterMenu threads={allListed} />
            </div>
            {/* Searching takes the tabs' place: the list under it stays where it was. */}
            <div className="inbox__switch">
              {searching ? (
                <div className="inbox__seek">
                  <SearchField
                    size="sm"
                    autoFocus
                    className="inbox__seekfield"
                    placeholder={t(`inbox.searchIn.${tab}`)}
                    value={query}
                    onChange={(e) => setQuery(e.currentTarget.value)}
                    onBlur={() => {
                      if (!query.trim()) closeSearch();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") closeSearch();
                    }}
                  />
                  <IconButton
                    size="sm"
                    label={t("inbox.searchClose")}
                    icon={<Icons.X size={14} />}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={closeSearch}
                  />
                </div>
              ) : (
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
              )}
            </div>
            <InboxFilterChips />
          </>
        )}
      </div>
      <div className="inbox__list">
        {!ready && offline ? (
          <EmptyState icon={<Icons.WifiOff />} title={t("inbox.offline.title")}>
            {t("inbox.offline.body")}
          </EmptyState>
        ) : !ready ? (
          <InboxSkeleton />
        ) : allListed.length === 0 && archived.length === 0 ? (
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
        ) : (
          <ChatsTab entries={tabs.chats} archived={archived} />
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
