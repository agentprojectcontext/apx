import useSWR from "swr";
import { NavLink } from "react-router-dom";
import { Handshake, ListTodo, MessagesSquare } from "lucide-react";
import { Commitments } from "../../lib/api/commitments";
import { Tasks } from "../../lib/api/tasks";
import { CHAT_ROOT, COMMITMENTS_ROOT, TASKS_ROOT } from "./routes";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

/**
 * The phone's bottom bar: chats, tasks, promises.
 *
 * Three surfaces, one thumb. The phone used to be chat and only chat, so the
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
  const tabs = [
    { to: CHAT_ROOT,        icon: MessagesSquare, label: t("mobile.tab_chats"),       badge: 0,               testId: "mobile-tab-chats" },
    { to: TASKS_ROOT,       icon: ListTodo,       label: t("mobile.tab_tasks"),       badge: counts.openTasks, testId: "mobile-tab-tasks" },
    { to: COMMITMENTS_ROOT, icon: Handshake,      label: t("mobile.tab_commitments"), badge: counts.overdue,   tone: "danger" as const, testId: "mobile-tab-commitments" },
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
                {tab.badge > 0 && <Badge count={tab.badge} tone={tab.tone} />}
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
 * Two different numbers on purpose: tasks show how many are open (a workload),
 * commitments show how many are LATE (a person waiting). An "open promises"
 * count would sit there permanently and stop meaning anything — the whole point
 * of the red one is that it should normally not be there.
 */
function Badge({ count, tone }: { count: number; tone?: "danger" }) {
  return (
    <span
      className={cn(
        "absolute -right-2.5 -top-1.5 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums",
        tone === "danger" ? "bg-red-600 text-white" : "bg-primary text-primary-foreground",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
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
    "mobile-tabbar-open-tasks",
    () => Tasks.globalPage({ state: "open", limit: 1, offset: 0 }),
    { refreshInterval: 60_000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  const { data: overdue } = useSWR(
    "mobile-tabbar-overdue-commitments",
    () => Commitments.globalPage({ state: "open", overdue: true, limit: 1, offset: 0 }),
    { refreshInterval: 60_000, revalidateOnFocus: true, shouldRetryOnError: false },
  );
  return { openTasks: tasks?.total ?? 0, overdue: overdue?.total ?? 0 };
}
