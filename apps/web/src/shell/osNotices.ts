// The tray's new notices as the system's own notifications unless the owner is looking at the very chat they are about
// (APX in front, that chat open), and APX's own sound for each as it arrives. The desktop app allows them already; a
// browser asks on the owner's first click, as browsers require.

import type { Notification as Notice } from "@apx/protocol";
import { onNewNotice, readNotifications } from "../data/notifications.ts";
import { go, nav, showsChat } from "./nav.ts";
import { noticeTask } from "./noticeTarget.ts";
import { noticeArrived } from "./sounds.ts";

/** The owner has APX in front with this notice's chat open: the chat itself shows it. */
const looking = (n: Notice) => {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return false;
  const s = nav.get();
  return Boolean(n.thread_id) && s.threadId === n.thread_id && showsChat(s);
};

function show(n: Notice): void {
  noticeArrived(n.kind);
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || looking(n)) return;
  const os = new Notification(n.title, { body: n.body, tag: `${n.id}:${n.created_at}`, silent: true });
  os.onclick = () => {
    window.focus();
    if (n.kind !== "input") void readNotifications([n.id]);
    const task = noticeTask(n);
    if (task) go.task(task);
    else if (n.kind === "task" || n.kind === "due") go.view("tasks");
    else if (n.thread_id) go.inboxThread(n.thread_id);
    os.close();
  };
}

/** Starts showing new notices as system notifications; returns how to stop. */
export function startOsNotices(): () => void {
  const off = onNewNotice(show);
  const ask = () => {
    window.removeEventListener("pointerdown", ask);
    if (typeof Notification !== "undefined" && Notification.permission === "default")
      void Notification.requestPermission().catch(() => {});
  };
  window.addEventListener("pointerdown", ask);
  return () => {
    off();
    window.removeEventListener("pointerdown", ask);
  };
}
