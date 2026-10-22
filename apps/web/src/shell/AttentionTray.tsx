import type { Notification } from "@apx/protocol";
import { Button, Icons, Popover } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { pairingChannel } from "../data/channels.ts";
import { readNotifications, useAttention } from "../data/notifications.ts";
import { useT } from "../i18n/index.ts";
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
  } else if (n.kind === "channel") go.channelConfig("telegram");
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
    void import("./osNotices.ts").then((m) => {
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
      width={380}
      open={open}
      onOpenChange={setOpen}
      label={t("attention.label")}
      trigger={
        <button
          type="button"
          className={unread ? "attention is-active" : "attention"}
          aria-label={t("attention.aria", { n: unread })}
        >
          <Icons.Bell size={16} />
          {unread > 0 && <span className="attention__count">{unread > 99 ? "99+" : unread}</span>}
        </button>
      }
    >
      <div className="attention__head">
        <span className="attention__title">{t("attention.label")}</span>
        {unread > 0 && (
          <Button size="sm" variant="ghost" onClick={() => void readNotifications()}>
            {t("attention.readAll")}
          </Button>
        )}
      </div>
      {list.length ? (
        <div className="running__list">
          {list.map((n) => {
            const Icon = KIND_ICON[n.kind];
            return (
              <button
                key={n.id}
                type="button"
                className={n.read_at ? "running__row attention__row" : "running__row attention__row is-unread"}
                onClick={() => {
                  setOpen(false);
                  openNotice(n);
                }}
              >
                <span className={`attention__icon is-${n.level}`}>
                  <Icon size={14} />
                </span>
                <span className="running__item">
                  <span className="running__title">
                    {t(`attention.kind.${n.kind}`)} · {n.title}
                  </span>
                  {n.body && <span className="attention__body">{n.body}</span>}
                </span>
                <span className="running__elapsed">{shortWhen(n.created_at)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="running__empty">{t("attention.empty")}</p>
      )}
    </Popover>
  );
}
