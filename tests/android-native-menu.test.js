import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

test("Android options live in the /mobile header only when the native bridge exists", () => {
  const activity = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MainActivity.java");
  const inbox = read("src", "interfaces", "web", "src", "screens", "mobile", "MobileChatList.tsx");

  assert.match(activity, /addJavascriptInterface\(new AndroidBridge\(\), "APXAndroid"\)/);
  assert.match(activity, /@JavascriptInterface\s+public void openOptions\(\)/);
  assert.match(activity, /@JavascriptInterface\s+public boolean notificationsEnabled\(\)/);
  assert.match(activity, /Settings\.ACTION_APP_NOTIFICATION_SETTINGS/);
  assert.doesNotMatch(activity, /Button menu = button\("⋮"\)/);
  assert.match(inbox, /typeof window\.APXAndroid\?\.openOptions === "function"/);
  assert.match(inbox, /androidOptions && \(/);
  assert.match(inbox, /window\.APXAndroid\?\.openOptions\(\)/);
});

test("mobile preferences use Android notification state instead of browser capability", () => {
  const prefs = read("src", "interfaces", "web", "src", "components", "settings", "PanelPrefs.tsx");

  assert.match(prefs, /typeof window\.APXAndroid\?\.notificationsEnabled === "function"/);
  assert.match(prefs, /nativeNotifications \? <NativeNotificationStatus \/> : <NotificationSwitch \/>/);
  assert.match(prefs, /window\.APXAndroid\?\.openNotificationSettings\(\)/);
});
