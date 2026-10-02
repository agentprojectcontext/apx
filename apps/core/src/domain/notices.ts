// The owner's notice preferences, stored in settings and always read through the schema (bad values fall back).
import type { NoticePrefs } from "@apx/protocol";
import type { Store } from "./store.ts";

export function noticePrefs(store: Store): NoticePrefs {
  return store.settings.read("notices");
}

export function saveNoticePrefs(store: Store, prefs: NoticePrefs): NoticePrefs {
  store.settings.write("notices", prefs);
  return noticePrefs(store);
}
