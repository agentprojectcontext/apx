import { useMemo } from "react";
import useSWR from "swr";
import { useNavigate } from "react-router-dom";
import { BellOff, Hand, ListTodo, PauseCircle } from "lucide-react";
import { Loading } from "../../components/ui";
import { InboxRowItem } from "../../components/inbox/InboxRowItem";
import { Tasks, type GlobalTaskEntry } from "../../lib/api/tasks";
import { isRowUnread, inboxRowKey } from "../../lib/chat-read";
import { channelEnabledIn } from "../../lib/channels";
import { projectEnabledIn } from "../../lib/provenance";
import { useChannelPrefs } from "../../hooks/useChannelPrefs";
import { useProjectPrefs } from "../../hooks/useProjectPrefs";
import { useInbox } from "../../hooks/useInbox";
import { chatPath, keyFor, pidOf, TASKS_ROOT } from "./routes";
import { MobileGroupHeader, MobileListHeader } from "./mobileList";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/** One request per screenful; this list is meant to be short by construction. */
const PAGE = 60;

/**
 * Everything that is waiting on YOU, in one place.
 *
 * Asked for on 2026-09-20: "me falta una vista de notificaciones que centralice
 * cuando haya mensajes, task y demás que esperan mi respuesta". The parts
 * already existed and each lived behind its own tab, which is exactly the
 * problem — three lists to sweep to answer one question.
 *
 * TWO FETCHES, NOT A NEW ENDPOINT. The inbox already knows which chats are
 * unread and the task list already knows what is waiting (`awaits_owner`) and
 * what is stuck on you (`blocked_by_owner`). A third endpoint that merged them
 * server-side would be a second copy of both projections, free to disagree with
 * the lists it summarises — and a notification centre that disagrees with the
 * screen it sends you to is worse than no notification centre.
 *
 * THE BANDS ARE ORDERED BY WHAT THEY COST YOU. Something that asked you a
 * question is blocking somebody else's work; something unread might be a
 * status line; something blocked on you has been that way for a while and is
 * not news. That is also why "blocked on you" sinks in the task list and rises
 * here: it is not news, but it IS owed, and this is the screen that collects
 * what you owe.
 */
export function MobileAttention() {
  const navigate = useNavigate();
  const { rows: inboxRows, isLoading: inboxLoading } = useInbox();
  const view = useChannelPrefs("view");
  const scope = useProjectPrefs();

  const { data, isLoading: tasksLoading } = useSWR(
    "mobile-attention-tasks",
    () => Tasks.globalPage({ state: "open", limit: PAGE, offset: 0, sort: "attention" }),
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const tasks = useMemo(() => data?.items ?? [], [data]);

  // The same two switches the chat list obeys. A row for a channel this device
  // has hidden is a row you cannot clear — you would open it, find nothing, and
  // it would still be here.
  const unreadChats = useMemo(
    () => inboxRows.filter((r) =>
      channelEnabledIn(view.prefs, "view", r.channel) &&
      projectEnabledIn(scope.prefs, r.project_id) &&
      isRowUnread(r)),
    [inboxRows, view.prefs, scope.prefs],
  );

  const awaiting = useMemo(() => tasks.filter((x) => x.awaits_owner), [tasks]);
  const unreadTasks = useMemo(
    () => tasks.filter((x) => x.unread && !x.awaits_owner),
    [tasks],
  );
  const blocked = useMemo(() => tasks.filter((x) => x.blocked_by_owner && !x.awaits_owner), [tasks]);

  const loading = (inboxLoading && !inboxRows.length) || (tasksLoading && !data);
  const empty = !loading && !unreadChats.length && !awaiting.length && !unreadTasks.length && !blocked.length;

  const openTask = (task: GlobalTaskEntry) => {
    // The task list is where a task can be answered, commented on and closed.
    // Duplicating those verbs here would be a second task detail to keep in
    // step with the first one.
    navigate(`${TASKS_ROOT}?task=${encodeURIComponent(task.id)}&pid=${task.project_id}`);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <MobileListHeader title={t("mobile.tab_attention")} />

      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="mobile-attention-list">
        {loading && <div className="py-10"><Loading /></div>}

        {empty && (
          <p className="px-4 py-16 text-center text-sm text-muted-fg" data-testid="mobile-attention-empty">
            <BellOff size={20} className="mx-auto mb-2 opacity-50" />
            {t("mobile.attention_empty")}
          </p>
        )}

        {awaiting.length > 0 && (
          <section data-testid="mobile-attention-awaiting">
            <MobileGroupHeader label={t("mobile.attention_awaiting")} count={awaiting.length} />
            <ul className="divide-y divide-border/60">
              {awaiting.map((task) => (
                <AttentionTask key={`${task.project_id}-${task.id}`} task={task} tone="ask" onOpen={() => openTask(task)} />
              ))}
            </ul>
          </section>
        )}

        {unreadChats.length > 0 && (
          <section data-testid="mobile-attention-chats">
            <MobileGroupHeader label={t("mobile.attention_chats")} count={unreadChats.length} />
            <ul className="divide-y divide-border/60">
              {unreadChats.map((row) => (
                <InboxRowItem
                  key={inboxRowKey(row)}
                  row={row}
                  variant="touch"
                  onSelect={(r) => navigate(chatPath(pidOf(r), r.agent_slug, keyFor(r)))}
                />
              ))}
            </ul>
          </section>
        )}

        {unreadTasks.length > 0 && (
          <section data-testid="mobile-attention-unread-tasks">
            <MobileGroupHeader label={t("mobile.attention_unread_tasks")} count={unreadTasks.length} />
            <ul className="divide-y divide-border/60">
              {unreadTasks.map((task) => (
                <AttentionTask key={`${task.project_id}-${task.id}`} task={task} tone="new" onOpen={() => openTask(task)} />
              ))}
            </ul>
          </section>
        )}

        {blocked.length > 0 && (
          <section data-testid="mobile-attention-blocked">
            <MobileGroupHeader label={t("mobile.attention_blocked")} count={blocked.length} />
            <ul className="divide-y divide-border/60">
              {blocked.map((task) => (
                <AttentionTask key={`${task.project_id}-${task.id}`} task={task} tone="blocked" onOpen={() => openTask(task)} />
              ))}
            </ul>
          </section>
        )}

        <div className="h-4" />
      </div>
    </div>
  );
}

const TONE_ICON = {
  ask: Hand,
  new: ListTodo,
  blocked: PauseCircle,
} as const;

const TONE_CLASS = {
  ask: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  new: "bg-muted text-muted-fg",
  blocked: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
} as const;

/** A task as it reads on this screen: why it is here, then what it is. */
function AttentionTask({ task, tone, onOpen }: {
  task: GlobalTaskEntry;
  tone: keyof typeof TONE_ICON;
  onOpen: () => void;
}) {
  const Icon = TONE_ICON[tone];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`mobile-attention-task-${task.id}`}
        className="flex w-full min-w-0 items-start gap-3 px-4 py-3 text-left active:bg-accent/50"
      >
        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[tone])}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-snug [overflow-wrap:anywhere]">
            {task.title}
          </span>
          {task.last_comment && (
            <span className="mt-0.5 block truncate text-xs text-muted-fg">
              <b className="font-medium text-fg/70">{task.last_comment.by || "?"}:</b>{" "}
              {task.last_comment.text}
            </span>
          )}
          <span className="mt-0.5 block truncate text-[11px] text-muted-fg">
            {[task.project_name?.split("/").pop(), task.agent].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
    </li>
  );
}

/** How many things are waiting — the number on this tab. */
export function useAttentionCount(): number {
  const { rows } = useInbox();
  const view = useChannelPrefs("view");
  const scope = useProjectPrefs();
  const { data } = useSWR(
    "mobile-attention-tasks",
    () => Tasks.globalPage({ state: "open", limit: PAGE, offset: 0, sort: "attention" }),
    { revalidateOnFocus: true, keepPreviousData: true },
  );
  const chats = rows.filter((r) =>
    channelEnabledIn(view.prefs, "view", r.channel) &&
    projectEnabledIn(scope.prefs, r.project_id) &&
    isRowUnread(r)).length;
  // Chats + what ASKED you something. Deliberately not counting `blocked`: it
  // has been owed since Tuesday and would pin a number to this tab that never
  // goes down, which is the badge everyone learns to ignore.
  const asking = (data?.items ?? []).filter((x) => x.awaits_owner || x.unread).length;
  return chats + asking;
}
