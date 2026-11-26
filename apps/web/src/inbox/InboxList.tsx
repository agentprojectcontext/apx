import type { Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, SearchField, SegmentedControl, Spinner } from "@apx/ui";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { markAllRead } from "../data/actions.ts";
import { useChannels } from "../data/channels.ts";
import { findProject, isWorking } from "../data/identity.ts";
import { type InboxTab, setPrefs, usePrefs } from "../data/prefs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { AccountContacts, AccountHeader } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import { contactsWithoutChat } from "./accountContacts.ts";
import { archivedThreads, inboxEntries, unreadUnder } from "./groupThreads.ts";
import { InboxFilterChips, InboxFilterMenu } from "./InboxFilterMenu.tsx";
import { InboxSkeleton } from "./InboxSkeleton.tsx";
import { ChatsTab, RoutinesTab, TasksTab } from "./InboxTabs.tsx";
import { agentsOnly, filterCount, passesFilter, soleFilter, useInboxFilter } from "./inboxFilter.ts";
import { NewChatMenu, startChat, useChatAgents } from "./NewChatMenu.tsx";
import "./revealOpen.ts";

const TAB_ORDER = ["chats", "tasks", "routines"] as const;
// The same marks as the sidebar's; a narrow Inbox shows them in place of the names.
const TAB_ICON = {
  chats: <Icons.MessageSquare size={14} className="inbox__tabicon" aria-hidden />,
  tasks: <Icons.ListChecks size={14} className="inbox__tabicon" aria-hidden />,
  routines: <Icons.Clock size={14} className="inbox__tabicon" aria-hidden />,
};

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
  const inboxFilter = useInboxFilter((s) => s);
  const inboxHidden = usePrefs((s) => s.inboxHiddenChannels);
  // In a project only its agents narrow the list; what the Inbox was narrowed to stays the Inbox's.
  const filter = useMemo(() => (projectId ? agentsOnly(inboxFilter) : inboxFilter), [projectId, inboxFilter]);
  const hidden = useMemo(() => (projectId ? [] : inboxHidden), [projectId, inboxHidden]);
  const filtered = filterCount(filter) > 0 || hidden.length > 0;
  const channels = useChannels((s) => s.channels);
  // Narrowed to one channel account, the Inbox is that account's: its header, its chats.
  const sole = soleFilter(filter);
  const account = !projectId && sole?.kind === "accounts" ? channels.find((c) => c.id === sole.id) : undefined;
  const chatAgents = useChatAgents(projectId);
  const persons = useChannels((s) => s.persons);
  // An account's list ends with the contacts it can reach who have no chat yet.
  const contacts = useMemo(
    () => (account ? contactsWithoutChat(persons, threads, account.id, query) : []),
    [account, persons, threads, query],
  );

  const byChannel = usePrefs((s) => s.inboxByChannel);
  const savedTab = usePrefs((s) => s.inboxTab);
  const tab: InboxTab = account ? "chats" : savedTab;
  const listRef = useRef<HTMLDivElement>(null);
  const pickedAt = useRef(Number.NEGATIVE_INFINITY);
  const openThread = useNav((s) => s.threadId);
  const openRoutine = useNav((s) => s.routineId);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const picked = () => {
      pickedAt.current = performance.now();
    };
    list.addEventListener("pointerdown", picked);
    list.addEventListener("keydown", picked);
    return () => {
      list.removeEventListener("pointerdown", picked);
      list.removeEventListener("keydown", picked);
    };
  }, []);
  // The chat opened elsewhere comes into view in the list (its tab and fold open in revealOpen); one picked here stays put.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !ready || (!openThread && !openRoutine) || performance.now() - pickedAt.current < PICK_MS) return;
    return revealSelected(list);
  }, [openThread, openRoutine, ready]);
  const entries = useMemo(
    () => inboxEntries(threads, { projectId, query, routines: true }),
    [threads, projectId, query],
  );
  const allListed = useMemo(() => entries.flatMap((e) => (e.kind === "thread" ? [e.thread] : e.threads)), [entries]);
  const tabs = useMemo(() => {
    const kindOf = (id: string) => channels.find((c) => c.id === id)?.type;
    const ok = (th: Thread) => passesFilter(th, filter, projects, kindOf, hidden);
    return {
      chats: entries.flatMap((e) => (e.kind === "thread" && ok(e.thread) ? [e.thread] : [])),
      tasks: entries.flatMap((e) => (e.kind === "task" && e.threads.some(ok) ? [e] : [])),
      routines: entries.flatMap((e) => (e.kind === "routine" && e.threads.some(ok) ? [e] : [])),
    };
  }, [entries, filter, projects, channels, hidden]);
  // What each tab's "Mark all as read" takes: its rows and the chats delegated under them.
  const unreadByTab = useMemo(
    () => ({
      chats: unreadUnder(threads, tabs.chats),
      tasks: unreadUnder(
        threads,
        tabs.tasks.flatMap((e) => e.threads),
      ),
      routines: unreadUnder(
        threads,
        tabs.routines.flatMap((e) => e.threads),
      ),
    }),
    [threads, tabs],
  );
  // Each tab tells how many of its rows are running and, once they finish, how many wait to be read; never its total.
  const marks = useMemo(() => {
    const of = (rows: Thread[][]) => ({
      working: rows.filter((r) => r.some((th) => isWorking(th.state))).length,
      news: rows.filter((r) => r.some((th) => th.unread > 0)).length,
    });
    return {
      chats: of(tabs.chats.map((th) => [th])),
      tasks: of(tabs.tasks.map((e) => e.threads)),
      routines: of(tabs.routines.map((e) => e.threads)),
    };
  }, [tabs]);
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
          <>
            <Suspense fallback={<h1 className="inbox__title">{account.label}</h1>}>
              <AccountHeader account={account} />
            </Suspense>
            <SearchField
              size="sm"
              className="inbox__accountfind"
              aria-label={t("inbox.searchIn.chats")}
              placeholder={t("inbox.searchIn.chats")}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery("");
              }}
            />
          </>
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
              <InboxFilterMenu threads={allListed} agentsOnly={Boolean(projectId)} />
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
                  menu={(v) => {
                    const ids = unreadByTab[v as InboxTab];
                    return [
                      {
                        label: t("inbox.markAllRead"),
                        icon: <Icons.CheckCheck />,
                        disabled: ids.length === 0,
                        onSelect: () => markAllRead(ids),
                      },
                    ];
                  }}
                  options={TAB_ORDER.map((v) => ({
                    value: v,
                    label: (
                      <>
                        <span className="inbox__tabname">
                          {TAB_ICON[v]}
                          <span className="inbox__tabtext">{t(`inbox.tab.${v}`)}</span>
                        </span>
                        {/* Running: a spinner and how many. Done: how many wait to be read, by a still dot. */}
                        {marks[v].working > 0 ? (
                          <span
                            className="inbox__tabwork"
                            role="img"
                            aria-label={t("inbox.tabWorking", { count: marks[v].working })}
                          >
                            <Spinner size={10} />
                            <span className="inbox__tabworkn">{capped(marks[v].working)}</span>
                          </span>
                        ) : (
                          marks[v].news > 0 && (
                            <span
                              className="inbox__tabwork is-news"
                              role="img"
                              aria-label={t("inbox.tabNews", { count: marks[v].news })}
                            >
                              <span className="inbox__tabnewsdot" />
                              <span className="inbox__tabworkn">{capped(marks[v].news)}</span>
                            </span>
                          )
                        )}
                      </>
                    ),
                  }))}
                />
              )}
            </div>
            <InboxFilterChips agentsOnly={Boolean(projectId)} />
          </>
        )}
      </div>
      <div className="inbox__list" ref={listRef}>
        {!ready && offline ? (
          <EmptyState icon={<Icons.WifiOff />} title={t("inbox.offline.title")}>
            {t("inbox.offline.body")}
          </EmptyState>
        ) : !ready ? (
          <InboxSkeleton />
        ) : allListed.length === 0 && archived.length === 0 && contacts.length === 0 ? (
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
          // One account's own list has nothing to group.
          <ChatsTab
            entries={tabs.chats}
            archived={archived}
            byChannel={byChannel && !account}
            account={Boolean(account)}
            tail={
              account &&
              contacts.length > 0 && (
                <Suspense fallback={null}>
                  <AccountContacts account={account} contacts={contacts} />
                </Suspense>
              )
            }
          />
        )}
      </div>
    </section>
  );
}

/** How long after a press in the list a chat that opens counts as picked there. */
const PICK_MS = 1000;
/** How long a chat opened elsewhere may take to show in the list (the list and its tab's rows load late). */
const REVEAL_MS = 10_000;

/**
 * Scrolls the selected row into the middle of the list once it shows, unless it already shows whole; the owner
 * touching the list first stops it. Returns what stops waiting.
 */
function revealSelected(list: HTMLElement): () => void {
  const look = (): boolean => {
    const row = list.querySelector<HTMLElement>(".apx-convrow.is-selected, .tree__session.is-selected");
    if (!row) return false;
    const box = list.getBoundingClientRect();
    const at = row.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) list.scrollTop += at.top - box.top - (box.height - at.height) / 2;
    return true;
  };
  const watch = new MutationObserver(() => {
    if (look()) stop();
  });
  const timer = setTimeout(() => stop(), REVEAL_MS);
  const stop = () => {
    watch.disconnect();
    clearTimeout(timer);
    for (const e of ["pointerdown", "keydown", "wheel"]) list.removeEventListener(e, stop);
  };
  if (look()) {
    stop();
    return stop;
  }
  watch.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  for (const e of ["pointerdown", "keydown", "wheel"]) list.addEventListener(e, stop);
  return stop;
}

/** A tab's count, short enough for its pill. */
const capped = (n: number): string => (n > 99 ? "99+" : String(n));
