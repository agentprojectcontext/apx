// The owner's notice preferences, stored in settings and always read through the schema (bad values fall back), and
// the quiet hours they set.
import type { NoticePrefs } from "@apx/protocol";
import { minutesOf } from "./hours.ts";
import type { Store } from "./store.ts";

export function noticePrefs(store: Store): NoticePrefs {
  return store.settings.read("notices");
}

export function saveNoticePrefs(store: Store, prefs: NoticePrefs): NoticePrefs {
  store.settings.write("notices", prefs);
  return noticePrefs(store);
}

type Quiet = Pick<NoticePrefs, "quiet_from" | "quiet_to">;

/** Whether `now` (local time) falls in the quiet window; a window may cross midnight (23:00 → 08:00). */
export function inQuietHours(prefs: Quiet, now = new Date()): boolean {
  if (!prefs.quiet_from || !prefs.quiet_to) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutesOf(prefs.quiet_from);
  const to = minutesOf(prefs.quiet_to);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

/** When the quiet window `now` is in ends (local time): today's or tomorrow's `quiet_to`. */
export function quietEnd(prefs: Quiet, now = new Date()): Date {
  const to = minutesOf(prefs.quiet_to ?? "00:00");
  const end = new Date(now);
  end.setHours(Math.floor(to / 60), to % 60, 0, 0);
  if (end <= now) end.setDate(end.getDate() + 1);
  return end;
}
