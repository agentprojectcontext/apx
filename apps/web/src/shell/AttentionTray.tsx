import type { Notification } from "@apx/protocol";
import { AgentAvatar, Button, EngineIcon, IconButton, Icons, Popover } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { pairingChannel } from "../data/channels.ts";
import { blobOf, projectName, threadAgent } from "../data/identity.ts";
import { readNotifications, useAttention } from "../data/notifications.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { loadOsNotices } from "../lazy.ts";
import { go } from "./nav.ts";
import { noticeTask } from "./noticeTarget.ts";

const KIND_ICON: Record<Notification["kind"], typeof Icons.Bell> = {
  input: Icons.Hand,
  task: Icons.ListChecks,
  due: Icons.Calendar,
  routine: Icons.Clock,
  channel: Icons.Send,
  agent: Icons.Bell,
  run: Icons.Activity,
};

/** Opens what a notice is about. A question stays in the tray until it is answered. */
function openNotice(n: Notification): void {
  if (n.kind !== "input") void readNotifications([n.id]);
  const task = noticeTask(n);
  if (task) go.task(task);
  else if (n.kind === "task" || n.kind === "due") go.view("tasks");
  else if (n.thread_id) go.inboxThread(n.thread_id);
  else if (n.kind === "channel" && n.ref?.startsWith("pairing:")) {
    // Someone waits to be let in: their row, lit, in the channel's own list — where it can be answered.
    go.channel(pairingChannel(n.ref.slice(8)) ?? "telegram", undefined);
    go.focus(n.ref);
  } else if (n.kind === "channel") go.view("channels");
}

/** Topbar bell: what wants the owner (an agent's question or news, a task waiting, a routine's news, a channel matter). */
export function AttentionTray() {
  const t = useT();
  const items = useAttention((s) => s.items);
  const unread = useAttention((s) => s.unread);
  const [open, setOpen] = useState(false);
  // Loaded after the first paint: it only matters once a notice arrives, and keeps the initial bundle in budget.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void loadOsNotices().then((m) => {
      if (!gone) stop = m.startOsNotices();
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);
  useEffect(() => {
    window.apxDesktop?.setAttention?.(unread);
  }, [unread]);
  const list = useMemo(
    () =>
      Object.values(items)
        .sort((a, b) => Number(!b.read_at) - Number(!a.read_at) || b.created_at.localeCompare(a.created_at))
        .slice(0, 30),
    [items],
  );
  return (
    <Popover
      align="end"
      width={360}
      open={open}
      onOpenChange={setOpen}
      label={t("topbar.notifications")}
      trigger={
        <IconButton
          size="sm"
          className={unread ? "attention has-unread" : "attention"}
          label={t("attention.aria", { n: unread })}
          icon={
            <>
              <span className="attention__bell">
                <Icons.Bell size={16} />
                {unread > 0 && <span className="attention__dot" />}
              </span>
              {unread > 0 && <span className="attention__count">{unread > 99 ? "99+" : unread}</span>}
            </>
          }
        />
      }
    >
      <div className="attention__head">
        <span className="attention__title">{t("topbar.notifications")}</span>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void readNotifications()}>
            {t("attention.readAll")}
          </Button>
        )}
      </div>
      {list.length ? (
        <div className="running__list">
          {list.map((n) => (
            <NoticeRow
              key={n.id}
              notice={n}
              onOpen={() => {
                setOpen(false);
                openNotice(n);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="running__empty">{t("attention.empty")}</p>
      )}
    </Popover>
  );
}

/** A notice: who it comes from, what happened and when, the text in two lines, then who · project. */
function NoticeRow({ notice: n, onOpen }: { notice: Notification; onOpen: () => void }) {
  const t = useT();
  const thread = useData((s) => (n.thread_id ? s.threads[n.thread_id] : undefined));
  const agent = useData((s) => threadAgent(thread, s.agents));
  const projects = useData((s) => s.projects);
  const engine = useData((s) => (thread?.engine ? s.engines.find((e) => e.id === thread.engine) : undefined));
  const Icon = KIND_ICON[n.kind];
  const kind = t(`attention.kind.${n.kind}`);
  const who = agent?.name ?? (thread?.engine ? (engine?.label ?? thread.engine) : undefined);
  // A notice titled after its agent says what happened instead; the agent's name goes to the foot.
  const titled = n.title !== who;
  const meta = [titled ? kind : undefined, who, thread ? projectName(projects, thread.project_id) : undefined].filter(
    Boolean,
  );
  return (
    <button type="button" className={n.read_at ? "attention__row" : "attention__row is-unread"} onClick={onOpen}>
      {agent ? (
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={28} animated={false} />
      ) : thread?.engine ? (
        <EngineIcon engine={thread.engine} tile size={28} />
      ) : (
        <span className={`attention__icon is-${n.level}`}>
          <Icon size={14} />
        </span>
      )}
      <span className="attention__main">
        <span className="attention__top">
          <span className="attention__subject">{titled ? n.title : kind}</span>
          <span className="attention__time">{shortWhen(n.created_at)}</span>
        </span>
        {n.body && <span className="attention__body">{n.body}</span>}
        {meta.length > 0 && <span className="attention__meta">{meta.join(" · ")}</span>}
      </span>
    </button>
  );
}
