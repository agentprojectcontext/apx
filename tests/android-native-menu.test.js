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
  // The detection moved to lib/net.ts (isNativeShell) when the chat header
  // needed the same answer: inside the app the WebView is already laid out
  // below the system bars, and paying for them twice opened every chat with a
  // band of empty space the list it came from does not have.
  const net = read("src", "interfaces", "web", "src", "lib", "net.ts");
  assert.match(net, /export function isNativeShell\(\): boolean/);
  assert.match(net, /typeof window\.APXAndroid\?\.openOptions === "function"/);
  assert.match(inbox, /const androidOptions = isNativeShell\(\);/);
  assert.match(inbox, /androidOptions && \(/);
  assert.match(inbox, /window\.APXAndroid\?\.openOptions\(\)/);

  const chat = read("src", "interfaces", "web", "src", "screens", "project", "ChatTab.tsx");
  assert.match(chat, /isNativeShell\(\) \? "pt-1\.5" : "pt-\[max\(0\.5rem,env\(safe-area-inset-top\)\)\]"/);
});

test("mobile preferences use Android notification state instead of browser capability", () => {
  const prefs = read("src", "interfaces", "web", "src", "components", "settings", "PanelPrefs.tsx");

  assert.match(prefs, /typeof window\.APXAndroid\?\.notificationsEnabled === "function"/);
  assert.match(prefs, /nativeNotifications \? <NativeNotificationStatus \/> : <NotificationSwitch \/>/);
  assert.match(prefs, /window\.APXAndroid\?\.openNotificationSettings\(\)/);
});

test("looking at the connection is not a decision to leave the daemon", () => {
  // This screen was a dead end with a trap at the entrance. The menu item
  // cleared the pairing BEFORE showing it, so the connection was gone before
  // anything was typed; and `onBackPressed` on a screen with no WebView falls
  // through to super, which closes the app. Opening it to read the address cost
  // you the pairing and the session.
  const activity = read("src", "interfaces", "android", "app", "src", "main", "java", "dev", "agentprojectcontext", "apx", "MainActivity.java");

  // Nothing is destroyed on the way in. The stored pairing is replaced only by
  // a NEW one that actually succeeded.
  assert.doesNotMatch(activity, /preferences\.clearPairing\(\);\s*\n\s*showPairing/);
  // The index moves whenever the menu grows a row (it did when "Actualizar"
  // landed above it). Pinned to the LABEL's position rather than to a number,
  // so the next row added fails this in a way that names what happened.
  assert.match(activity, /if \(which == 9\) showPairing\(null, null, false\);/);
  assert.match(activity, /"Ver o cambiar la conexión"/);
  assert.match(activity, /preferences\.savePairing\(base, token\)/);

  // Two ways out, and both mean the same thing: the button for a thumb, the
  // system gesture for everyone who never looks for one.
  assert.match(activity, /back\.setOnClickListener\(ignored -> openMobile\(null\)\)/);
  assert.match(activity, /if \(webView == null && preferences\.paired\(\)\) \{ openMobile\(null\); return; \}/);

  // Offered only when there is somewhere to go back TO — on a first run this
  // screen IS the app.
  assert.match(activity, /if \(alreadyPaired\) \{/);
});
