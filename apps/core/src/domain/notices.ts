// The owner's notice preferences, stored in settings and always read through the schema (bad values fall back), and
// the quiet hours they set.
import { type NoticePrefs, noticeChannelChoice } from "@apx/protocol";
import { localTime, minutesOf } from "./hours.ts";
import { ownerTimeZone } from "./owner.ts";
import type { Origin } from "./runs.ts";
import type { Store } from "./store.ts";

export function noticePrefs(store: Store): NoticePrefs {
  return store.settings.read("notices");
}

export function saveNoticePrefs(store: Store, prefs: NoticePrefs): NoticePrefs {
  store.settings.write("notices", prefs);
  return noticePrefs(store);
}

/**
 * No chat app takes what APX says unasked: the tray and paired phones only. A phone picked before every phone was told
 * is the same choice (DECISIONS.md#d-161).
 */
export const appOnly = (prefs: Pick<NoticePrefs, "channel">): boolean => noticeChannelChoice(prefs.channel) === "none";

/**
 * A turn on the owner's side that follows their word (theirs, an answer, the result of what they asked): it may answer
 * on the chat app they wrote from even when no chat app takes notices. The rest is unasked.
 */
export function followsOwner(origin: Origin | undefined): boolean {
  switch (origin?.kind) {
    case "user":
    case "channel":
    case "input_answer":
    case "delegation_result":
    case "go_on":
    case "terminal":
      return true;
    case undefined:
    case "agent":
    case "surface":
    case "hours_began":
    case "routine":
    case "job":
    case "task_continue":
    case "stalled_task":
    case "added":
    case "computer_ready":
    case "task_result":
      return false;
  }
}

type Quiet = Pick<NoticePrefs, "quiet_from" | "quiet_to">;

/**
 * Whether `now` falls in the quiet window on the clocks of `timeZone` (none: this machine's); a window may cross
 * midnight (23:00 → 08:00).
 */
export function inQuietHours(prefs: Quiet, now = new Date(), timeZone?: string): boolean {
  if (!prefs.quiet_from || !prefs.quiet_to) return false;
  const at = localTime(now, timeZone).minutes;
  const from = minutesOf(prefs.quiet_from);
  const to = minutesOf(prefs.quiet_to);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

/** When the quiet window `now` is in ends, on the clocks of `timeZone`: today's or tomorrow's `quiet_to`. */
export function quietEnd(prefs: Quiet, now = new Date(), timeZone?: string): Date {
  const to = minutesOf(prefs.quiet_to ?? "00:00");
  const ahead = (to - localTime(now, timeZone).minutes + 1440) % 1440 || 1440;
  return new Date(now.getTime() - (now.getTime() % 60_000) + ahead * 60_000);
}

/** Whether the owner's quiet hours are on now, on their own clock (DECISIONS.md#d-031). */
export const quietNow = (store: Store, at = new Date()): boolean =>
  inQuietHours(noticePrefs(store), at, ownerTimeZone(store));
