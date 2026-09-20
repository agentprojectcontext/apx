import useSWR from "swr";
import { NavLink } from "react-router-dom";
import { Bell, Handshake, ListTodo, MessagesSquare } from "lucide-react";
import { Commitments } from "../../lib/api/commitments";
import { Tasks } from "../../lib/api/tasks";
import { ATTENTION_ROOT, CHAT_ROOT, COMMITMENTS_ROOT, TASKS_ROOT } from "./routes";
import { useAttentionCount } from "./MobileAttention";
import { useUnreadChats } from "../../hooks/useChatRead";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * The phone's bottom bar: chats, tasks, promises, and what is waiting on you.
 *
 * Four surfaces, one thumb. The phone used to be chat and only chat, so the
 * way to your own task list was to open the desktop panel — on a phone, in a
 * three-pane layout, to read twelve rows. These are the three things you check
 * standing up, so they are the three things that get a tab.
 *
 * Deliberately NOT shown inside a chat: that screen is a composer with a
 * keyboard over it, and a nav bar there is 56px of thumb-height target sitting
 * exactly where the send button goes.
 */
export function MobileTabBar() {
  const counts = useTabCounts();
  const unreadChats = useUnreadChats();
  const waiting = useAttentionCount();
  const tabs = [
    {
      to: CHAT_ROOT, icon: MessagesSquare, label: t("mobile.tab_chats"),
      badge: unreadChats, tone: "unread" as const, testId: "mobile-tab-chats",
      badgeLabel: t("mobile.tab_chats_badge", { count: unreadChats }),
    },
    {
      to: TASKS_ROOT, icon: ListTodo, label: t("mobile.tab_tasks"),
      badge: counts.dueTasks, testId: "mobile-tab-tasks",
      badgeLabel: t("mobile.tab_tasks_badge", { count: counts.dueTasks }),
    },
    {
      to: COMMITMENTS_ROOT, icon: Handshake, label: t("mobile.tab_commitments"),
      badge: counts.overdue, tone: "danger" as const, testId: "mobile-tab-commitments",
      badgeLabel: t("mobile.tab_commitments_badge", { count: counts.overdue }),
    },
    // Last, and deliberately: it is a summary of the three to its left, so it
    // is where you look when you do not want to sweep them one by one — not
    // the place the app opens.
    {
      to: ATTENTION_ROOT, icon: Bell, label: t("mobile.tab_attention"),
      badge: waiting, tone: "unread" as const, testId: "mobile-tab-attention",
      badgeLabel: t("mobile.tab_attention_badge", { count: waiting }),
    },
  ];

  return (
    <nav
      data-testid="mobile-tabbar"
      /* The bar owns the bottom inset itself. Its parent is `overflow-hidden`
         with no padding, because the scrolling list above must be able to run
         all the way under the home indicator while it scrolls. */
      className="flex shrink-0 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)]"
    >
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          data-testid={tab.testId}
          className={({ isActive }) =>
            cn(
              "relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] transition-colors active:bg-accent/50",
              isActive ? "text-primary" : "text-muted-fg",
            )
          }
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <tab.icon size={21} strokeWidth={isActive ? 2.4 : 1.9} />
                {tab.badge > 0 && <Badge count={tab.badge} tone={tab.tone} label={tab.badgeLabel} />}
              </span>
              <span className={cn("leading-none", isActive && "font-semibold")}>{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The number on the icon.
 *
 * ALL THREE COUNT SOMETHING YOU HAVE TO DO NOW. Tasks used to show every open
 * one, which on a real backlog is a permanent two-digit number: it said "31"
 * for weeks and nobody could tell you whether that meant unread, due, or owed
 * — a badge you cannot read is decoration. It counts what is due today or
 * already late, which is the same question the list's first two groups answer.
 *
 * Each one carries a sentence saying what it counts, because a number floating
 * over an icon can say it to a screen reader even when it cannot say it to an
 * eye.
 */
function Badge({ count, tone, label }: { count: number; tone?: "danger" | "unread"; label?: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      className={cn(
        "absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums",
        tone === "danger" ? "bg-red-600 text-white"
          // The same blue as the dot on the row it stands for.
          : tone === "unread" ? "bg-blue-500 text-white"
          : "bg-primary text-primary-foreground",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** End of today, as a string that sorts against however `due` was written. */
function endOfToday(): string {
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${day}T23:59:59.999Z`;
}

/**
 * Both counts in one place, shared by every screen that draws the bar.
 *
 * `limit: 1` — the interesting number is the envelope's `total`, and asking for
 * a page of rows to count them would pull every open task on the device into a
 * component that renders two digits.
 */
function useTabCounts() {
  const { data: tasks } = useSWR(
    "mobile-tabbar-due-tasks",
    () => Tasks.globalPage({ state: "open", limit: 1, offset: 0, due_before: endOfToday() }),
    { refreshInterval: 60_000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const { data: overdue } = useSWR(
    "mobile-tabbar-overdue-commitments",
    () => Commitments.globalPage({ state: "open", overdue: true, limit: 1, offset: 0 }),
    { refreshInterval: 60_000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  return { dueTasks: tasks?.total ?? 0, overdue: overdue?.total ?? 0 };
}
