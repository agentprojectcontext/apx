// The tray's new notices as the system's own notifications when the owner is not looking at APX (the window hidden,
// minimized or behind another app), and APX's own sound for each as it arrives. The desktop app allows them already; a browser asks on the
// owner's first click, as browsers require.

import type { Notification as Notice } from "@apx/protocol";
import { onNewNotice, readNotifications } from "../data/notifications.ts";
import { go } from "./nav.ts";
import { noticeTask } from "./noticeTarget.ts";
import { noticeArrived } from "./sounds.ts";

const looking = () => document.visibilityState === "visible" && document.hasFocus();

function show(n: Notice): void {
  noticeArrived(n.kind);
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || looking()) return;
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
