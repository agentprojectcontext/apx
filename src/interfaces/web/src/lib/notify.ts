// A notification when an agent says something and you are not looking.
//
// The panel already learns that a thread moved — lib/live.ts holds one socket
// for the whole app and the daemon tells it "conversation X moved". What it did
// NOT do is tell YOU: the inbox row reordered itself behind a backgrounded tab,
// and on the phone the app sat closed with nothing to show for the turn an
// agent had just finished. This module is that last hop.
//
// SIGNAL IN, CONTENT FETCHED. A live frame carries no text by design, so the
// preview comes from GET /api/inbox — the same rows the inbox screen renders,
// which already carry "what the AGENT last said". One request per burst, and
// only when notifications are actually on.
//
// Shown through the SERVICE WORKER, not `new Notification()`. Android Chrome
// throws "Illegal constructor" on the page-scoped API, so the constructor path
// would work on the laptop and fail on exactly the device this is for. The
// worker also owns the click, which is what lets tapping the notification
// focus the installed app instead of opening a second copy of it.
//
// WHAT THIS IS NOT: web push. Everything here needs the app to be running —
// a backgrounded tab or a backgrounded PWA counts, a fully closed one does not.
// Waking a closed app needs a push subscription, VAPID keys and a server that
// signs them; the click handler in sw.js is shared with that future, the
// subscription is not built.
import { Inbox, type InboxRow } from "./api/inbox";
import { t } from "../i18n";
import { subscribeLive } from "./live";
import { isSecure } from "./net";
// Pure URL helpers, no React: the tap has to land on the same path the inbox
// row would have navigated to, and there is exactly one place that knows it.
import { chatPath, keyFor, pidOf } from "../screens/mobile/routes";

const PREF_KEY = "apx.notify.agents";

/** Where a row's blob avatar lives — the same PNG the inbox draws. */
const BLOB_ICON = (key: string | null) => (key ? `/modules/blobs/${key}.png` : APP_ICON);
const APP_ICON = "/favicon/dark/android-chrome-192x192.png";

/** Newest activity per thread at the last time we looked. Seeded, never
 *  notified from, on the first pass — otherwise switching this on fires one
 *  notification per agent you have ever talked to. */
const seen = new Map<string, string>();
let seeded = false;
let started = false;
let unsubscribe: (() => void) | null = null;

const keyOf = (r: InboxRow) => `${r.project_id ?? ""}:${r.agent_slug}:${r.conversation_id ?? ""}`;

export type NotifyStance =
  | { kind: "on" }
  | { kind: "off" }           // supported and permitted, the user said no
  | { kind: "ask" }           // supported, permission not decided yet
  | { kind: "denied" }        // the browser is holding the no
  | { kind: "insecure" }      // http:// on a LAN address — no worker, no notifications
  | { kind: "unsupported" };

function supported(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

export function notificationsEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(PREF_KEY) === "1";
}

/** What the settings row should offer right now. */
export function notifyStance(): NotifyStance {
  if (!supported()) return isSecure() ? { kind: "unsupported" } : { kind: "insecure" };
  if (!isSecure()) return { kind: "insecure" };
  if (Notification.permission === "denied") return { kind: "denied" };
  if (Notification.permission !== "granted") return { kind: "ask" };
  return notificationsEnabled() ? { kind: "on" } : { kind: "off" };
}

/**
 * Turn them on: ask the browser, remember the answer, start watching.
 * Returns the stance afterwards so the caller can render the result of the
 * prompt rather than guessing at it.
 */
export async function enableNotifications(): Promise<NotifyStance> {
  if (!supported() || !isSecure()) return notifyStance();
  let permission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return notifyStance();
    }
  }
  if (permission !== "granted") return notifyStance();
  localStorage.setItem(PREF_KEY, "1");
  startAgentNotifications();
  return { kind: "on" };
}

export function disableNotifications() {
  if (typeof localStorage !== "undefined") localStorage.removeItem(PREF_KEY);
  // Stop watching too: the pref alone would leave a live subscription doing a
  // fetch per burst for notifications it is no longer allowed to show.
  resetNotifications();
}

/**
 * Reading the thread already counts as being told.
 *
 * Two surfaces, two URL shapes: the phone puts the agent in the path
 * (/mobile/chat/:pid/:slug), the desktop panel in the query
 * (/p/1/chat?agent=magui). Matching on the AGENT and not the conversation is
 * deliberate — you are looking at that agent's thread, and the row that moved
 * is the thread you are looking at.
 */
function looking(row: InboxRow): boolean {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("agent") === row.agent_slug) return true;
  const m = url.pathname.match(/^\/mobile\/chat\/[^/]+\/([^/]+)/);
  return !!m && decodeURIComponent(m[1]) === row.agent_slug;
}

async function show(row: InboxRow) {
  const reg = await navigator.serviceWorker.getRegistration();
  const title = row.agent_name || row.agent_slug;
  const body = (row.preview || "").trim().slice(0, 180);
  const options: NotificationOptions & { badge?: string; renotify?: boolean } = {
    body,
    icon: BLOB_ICON(row.agent_icon),
    // The monochrome silhouette Android puts in the status bar. The blob is a
    // colour PNG and comes out as a grey smudge there, so the app mark goes here.
    badge: APP_ICON,
    // One live notification per thread: an agent mid-turn writes several rows,
    // and a stack of five from the same conversation is noise, not news.
    tag: keyOf(row),
    renotify: true,
    data: { url: conversationUrl(row) },
  };
  if (reg) {
    await reg.showNotification(title, options);
    return;
  }
  // No worker (a desktop tab that never registered one): the page-scoped
  // constructor still works everywhere except Android, which has no tab.
  try {
    new Notification(title, options);
  } catch {
    /* nothing more to try */
  }
}

/**
 * One notification, on demand, so "on" can be confirmed instead of believed.
 *
 * Deliberately routed through the SAME `show()` the real ones use — service
 * worker registration and all. A test that took a shortcut would prove the
 * shortcut works: the interesting failures live exactly there (no worker
 * registered, Android refusing the page-scoped constructor, the browser
 * swallowing it while the tab has focus).
 *
 * Returns false when there is nothing to show it with, so the caller can say
 * so rather than leaving a button that looks like it did something.
 */
export async function sendTestNotification(): Promise<boolean> {
  if (notifyStance().kind !== "on") return false;
  try {
    await show({
      project_id: null,
      project_name: null,
      project_path: null,
      agent_slug: "__test__",
      agent_name: t("notify.test_title"),
      agent_emoji: null,
      agent_icon: null,
      kind: "agent",
      pinned: false,
      conversation_id: null,
      channel: null,
      messages: 0,
      preview: t("notify.test_body"),
      last_activity_at: new Date().toISOString(),
    } as InboxRow);
    return true;
  } catch {
    return false;
  }
}

/** Where tapping it should land: the same path the inbox row navigates to. */
export function conversationUrl(row: InboxRow): string {
  return chatPath(pidOf(row), row.agent_slug, keyFor(row));
}

/** Rows whose newest activity we had not seen yet. */
export function freshRows(rows: InboxRow[], previous: Map<string, string>): InboxRow[] {
  const out: InboxRow[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const at = row.last_activity_at || "";
    if (!at) continue;
    const before = previous.get(key);
    // Unseen counts as fresh, or the first message of a NEW conversation —
    // the one most worth telling you about — would be the one never announced.
    if (before === undefined || at > before) out.push(row);
    previous.set(key, at);
  }
  return out;
}

async function check() {
  if (!notificationsEnabled()) return;
  let rows: InboxRow[];
  try {
    rows = await Inbox.list();
  } catch {
    return; // a failed poll is not worth a notification about the poll
  }
  const fresh = freshRows(rows, seen);
  if (!seeded) {
    // First pass only fills the baseline: what was already there is not news.
    seeded = true;
    return;
  }
  for (const row of fresh) {
    // A row with no reply yet is the user's own message coming back around.
    if (!row.preview) continue;
    if (looking(row)) continue;
    await show(row).catch(() => {});
  }
}

/**
 * Start watching. Idempotent — the app calls it on boot and the settings row
 * calls it again when the switch goes on.
 */
export function startAgentNotifications() {
  if (started || !notificationsEnabled() || !supported() || !isSecure()) return;
  // The preference is this device's; the permission is the browser's, and it
  // can be revoked in site settings long after the switch was turned on.
  if (Notification.permission !== "granted") return;
  started = true;
  void check();                              // seed the baseline
  unsubscribe = subscribeLive(() => { void check(); });
}

/** Test seam: forget the baseline and the subscription. */
export function resetNotifications() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  seeded = false;
  seen.clear();
}
