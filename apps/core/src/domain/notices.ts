// The owner's notice preferences, stored in settings and always read through the schema (bad values fall back).
import { type NoticePrefs, NoticePrefs as NoticePrefsSchema } from "@apx/protocol";
import type { Store } from "./store.ts";

export function noticePrefs(store: Store): NoticePrefs {
  try {
    return NoticePrefsSchema.parse(JSON.parse(store.settings.get("notices") ?? "{}"));
  } catch {
    return NoticePrefsSchema.parse({});
  }
}

export function saveNoticePrefs(store: Store, prefs: NoticePrefs): NoticePrefs {
  store.settings.set("notices", JSON.stringify(prefs));
  return noticePrefs(store);
}
