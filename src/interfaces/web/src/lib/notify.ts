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
import { subscribeLive, type LiveEvent } from "./live";
import { isSecure } from "./net";
import { channelEnabled, isPhoneSurface } from "./channels";
// Pure URL helpers, no React: the tap has to land on the same path the inbox
// row would have navigated to, and there is exactly one place that knows it.
import { chatPath, keyFor, pidOf, queryForChat, urlLooksAt } from "../screens/mobile/routes";

const PREF_KEY = "apx.notify.agents";

/** Where a row's blob avatar lives — the same PNG the inbox draws. */
const BLOB_ICON = (key: string | null) => (key ? `/modules/blobs/${key}.png` : APP_ICON);
const APP_ICON = "/favicon/dark/android-chrome-192x192.png";

/** The agent's newest REPLY per thread at the last time we looked — not the
 *  thread's newest activity, which also moves for the owner's own send and for
 *  every tool the agent runs. Seeded, never notified from, on the first pass —
 *  otherwise switching this on fires one notification per agent you have ever
 *  talked to. */
const seen = new Map<string, string>();
/** When each thread last RANG, so a streamed answer arriving in five pieces
 *  updates one banner instead of ringing five times. */
const rang = new Map<string, number>();
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
 * Three surfaces, one question: is this row the thing on screen? The phone
 * puts the agent in the path (/mobile/chat/:pid/:slug), the desktop panel and
 * the inbox put the session in the query (`?agent=` / `?channel=&thread=`).
 * Matching only the agent slug missed groups and `/m/inbox` — both address a
 * thread, not an agent, so a reply you were watching also rang the bell.
 */
function looking(row: InboxRow): boolean {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
  return urlLooksAt(window.location.href, row);
}

/** How long one thread owns the bell. A Telegram answer is streamed in pieces
 *  and each piece is a real new reply, so the honest rendering is one alert and
 *  then a quiet running update of the same banner. */
const RING_EVERY_MS = 45_000;

async function show(row: InboxRow, { quiet = false }: { quiet?: boolean } = {}) {
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
    // `quiet` REPLACES the banner without alerting again — same thread, still
    // talking. renotify must go with it: it is what forces a second sound.
    renotify: !quiet,
    silent: quiet,
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

/**
 * Where tapping it should land — in the shape of the surface that raised it.
 *
 * The two frames address a session differently: the phone puts it in the PATH
 * (/mobile/chat/-/super_agent/web~2026-08-20), the desktop panel in the QUERY
 * (/p/0/chat?channel=web&thread=2026-08-20). This used to hand out the phone
 * path unconditionally, so clicking a notification on a laptop threw you into
 * the phone surface — a single-column chat with no sidebar, on a 27-inch
 * screen, for a panel you were already sitting in front of.
 */
export function conversationUrl(row: InboxRow): string {
  const key = keyFor(row);
  if (isPhoneSurface()) return chatPath(pidOf(row), row.agent_slug, key);
  // The desktop route has no "no project" sentinel: the super-agent lives in
  // workspace 0 there, which is the same place its own sidebar opens it from.
  const pid = row.project_id ?? 0;
  return `/p/${pid}/chat?${queryForChat(key).toString()}`;
}

/**
 * Rows where the AGENT has said something we had not seen yet.
 *
 * `preview_at` and not `last_activity_at`, and that one field is the whole
 * difference between a bell and an alarm. A thread's activity moves for the
 * owner's own send and for every tool row of a turn — 560 of them on one busy
 * Telegram day — so keying off it meant a notification for your own message the
 * instant you sent it, and another for every step the agent took answering it.
 * The agent's reply is the only thing here that is news.
 *
 * The baseline is updated for EVERY row, including ones this device is not
 * listening to: unmuting a channel should start telling you about what happens
 * next, not replay what you chose not to hear.
 */
export function freshRows(rows: InboxRow[], previous: Map<string, string>): InboxRow[] {
  const out: InboxRow[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const at = row.preview_at || "";
    if (!at) continue;
    const before = previous.get(key);
    // Unseen counts as fresh, or the first message of a NEW conversation —
    // the one most worth telling you about — would be the one never announced.
    if (before === undefined || at > before) out.push(row);
    previous.set(key, at);
  }
  return out;
}

/**
 * Is this burst worth asking the inbox about?
 *
 * The live feed carries every write: the owner's own message, each tool row,
 * each compaction. Fetching the inbox for all of them was 60-odd requests for
 * one 24-step turn, and every one of them a chance to ring about something that
 * was not an answer. An agent SPEAKING is the only thing that can produce a
 * notification, so it is the only thing that justifies the request.
 *
 * A ledger write says so with `type`/`direction`; a conversation write (a
 * project agent's own file) has neither and carries `role` instead. A resync
 * always passes: we were disconnected, and what we missed is exactly what this
 * is for.
 */
export function announcesAnAgentTurn(events: LiveEvent[]): boolean {
  return (events || []).some((e) => {
    if (e.scope === "resync") return true;
    if (e.role) return e.role === "assistant";
    if (e.type) return e.type === "agent" && e.direction === "out";
    return false;
  });
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
  const now = Date.now();
  for (const row of fresh) {
    // A row with no reply yet is the user's own message coming back around.
    if (!row.preview) continue;
    // This device's answer for this channel. The phone starts with Telegram
    // off — the app is ON it, so APX announcing a Telegram reply is the same
    // event twice — and the laptop starts with everything on. Either can be
    // changed per channel, per device, in Preferences.
    if (!channelEnabled("notify", row.channel)) continue;
    if (looking(row)) continue;
    // Same thread, still mid-answer: replace the banner, do not ring again.
    const key = keyOf(row);
    const quiet = now - (rang.get(key) ?? 0) < RING_EVERY_MS;
    if (!quiet) rang.set(key, now);
    await show(row, { quiet }).catch(() => {});
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
  // Every burst, but only a fetch when an agent actually spoke. The channel
  // filter is read at notification time rather than here, so switching a
  // channel back on takes effect on its next turn with no reload.
  unsubscribe = subscribeLive((events) => {
    if (announcesAnAgentTurn(events)) void check();
  });
}

/** Test seam: forget the baseline and the subscription. */
export function resetNotifications() {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
  seeded = false;
  seen.clear();
  rang.clear();
}
