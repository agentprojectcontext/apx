import assert from "node:assert/strict";
import { test } from "node:test";
import { createBus } from "../bus.ts";
import { openDb } from "../db/db.ts";
import { saveNoticePrefs } from "../domain/notices.ts";
import { createStore } from "../domain/store.ts";
import { tempDir } from "../testkit/platform.ts";
import { createNoticePush } from "./notice-push.ts";

test("every tray notice reaches the owner's phones; in quiet hours only questions and errors", async () => {
  const home = tempDir("apx-notice-push-");
  const bus = createBus();
  const db = openDb(home.path);
  const store = createStore(db, bus);
  const sent: string[] = [];
  let at = new Date(2026, 9, 27, 15, 0);
  const pusher = createNoticePush({
    store,
    bus,
    push: async (_target, m) => {
      sent.push(m.title);
      return true;
    },
    now: () => at,
  });
  try {
    const { device } = store.devices.create("Pixel", "android");
    store.devices.setPush(device.id, { kind: "expo", token: "ExponentPushToken[abc]" });
    store.notifications.add({ kind: "task", title: "Flows is ready for review" });
    store.notifications.add({ kind: "routine", title: "Morning news" });
    assert.deepEqual(sent, ["Flows is ready for review", "Morning news"]);

    saveNoticePrefs(store, { ...store.settings.read("notices"), quiet_from: "22:00", quiet_to: "07:30" });
    at = new Date(2026, 9, 27, 23, 0);
    store.notifications.add({ kind: "routine", title: "Night news" });
    store.notifications.add({ kind: "input", title: "Roby asks" });
    store.notifications.add({ kind: "channel", level: "error", title: "Telegram failed" });
    assert.deepEqual(sent.slice(2), ["Roby asks", "Telegram failed"]);
  } finally {
    pusher.stop();
    // Windows cannot remove a database file that is still open.
    db.close();
    await home.remove();
  }
});
