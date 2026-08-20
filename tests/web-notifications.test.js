// Agent notifications: the pieces that break silently.
//
// Everything here is a device-side behaviour no CI browser exercises, so the
// contract is pinned at the source. The three that would regress without a
// sound: showing them through the service worker (the page constructor throws
// on Android), not announcing the backlog the first time they are switched on,
// and the tap landing on the same path the inbox row navigates to.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");
const webPublic = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "public", ...p), "utf8");

test("notifications are shown through the service worker, not the page constructor", () => {
  // Android Chrome throws "Illegal constructor" on `new Notification()`. The
  // constructor may only ever be the fallback for a tab that has no worker.
  const notify = webSrc("lib", "notify.ts");
  // The function body, not the file: the header comment names the constructor
  // precisely to explain why it is the fallback.
  const show = notify.slice(notify.indexOf("async function show("), notify.indexOf("/** Where tapping"));
  assert.match(show, /serviceWorker\.getRegistration\(\)/);
  assert.match(show, /reg\.showNotification\(title, options\)/);
  const ctorAt = show.indexOf("new Notification(");
  const regAt = show.indexOf("reg.showNotification");
  assert.ok(regAt > 0 && ctorAt > regAt, "the worker path must come first");
});

test("the first pass only seeds — switching them on does not fire the backlog", () => {
  const notify = webSrc("lib", "notify.ts");
  const check = notify.slice(notify.indexOf("async function check()"));
  assert.match(check, /if \(!seeded\) \{[\s\S]*?seeded = true;[\s\S]*?return;/, "seed and return before notifying");
  assert.ok(
    check.indexOf("seeded = true") < check.indexOf("for (const row of fresh)"),
    "the baseline is taken before anything is shown"
  );
});

test("an unseen thread counts as fresh, so a brand-new conversation announces itself", () => {
  const notify = webSrc("lib", "notify.ts");
  assert.match(notify, /before === undefined \|\| at > before/);
});

test("one notification per thread, replaced rather than stacked", () => {
  const notify = webSrc("lib", "notify.ts");
  assert.match(notify, /tag: keyOf\(row\)/, "the thread key is the tag");
  assert.match(notify, /renotify: true/);
});

test("the icon is the agent's own blob, with the app mark as the badge", () => {
  const notify = webSrc("lib", "notify.ts");
  assert.match(notify, /\/modules\/blobs\/\$\{key\}\.png/, "the same PNG the inbox draws");
  assert.match(notify, /badge: APP_ICON/, "the status-bar glyph is monochrome, so it is the app mark");
});

test("the tap lands on the inbox row's own path, not a hand-built URL", () => {
  const notify = webSrc("lib", "notify.ts");
  assert.match(notify, /import \{ chatPath, keyFor, pidOf \} from "\.\.\/screens\/mobile\/routes"/);
  // Built from the same helpers the inbox row navigates with — on the phone
  // surface. The desktop shape is pinned in its own test below.
  assert.match(notify, /return chatPath\(pidOf\(row\), row\.agent_slug, key\)/);
});

test("the service worker owns the click and focuses one app instead of opening a second", () => {
  const sw = webPublic("sw.js");
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(sw, /client\.focus\(\)/);
  assert.ok(
    sw.indexOf("client.focus()") < sw.indexOf("openWindow"),
    "openWindow is the last resort, not the first move"
  );
});

test("reading the thread suppresses its notification on both surfaces", () => {
  const notify = webSrc("lib", "notify.ts");
  const looking = notify.slice(notify.indexOf("function looking("), notify.indexOf("async function show("));
  assert.match(looking, /visibilityState !== "visible"/, "a hidden page is never 'looking'");
  assert.match(looking, /searchParams\.get\("agent"\)/, "the desktop panel puts the agent in the query");
  assert.match(looking, /\\\/mobile\\\/chat\\\//, "the phone puts it in the path");
});

test("the switch never offers a button for a state the user cannot change here", () => {
  const prefs = webSrc("components", "settings", "PanelPrefs.tsx");
  for (const dead of ["insecure", "unsupported", "denied"]) {
    assert.match(prefs, new RegExp(`stance\\.kind === "${dead}"[\\s\\S]{0,200}?t\\("notify\\.${dead}"\\)`),
      `${dead} explains itself instead of rendering a button`);
  }
});

test("both locales carry every notify string", () => {
  const en = webSrc("i18n", "en.ts");
  const es = webSrc("i18n", "es.ts");
  for (const key of ["title", "on", "off", "on_hint", "off_hint", "denied", "insecure", "unsupported"]) {
    assert.match(en, new RegExp(`\\b${key}:`), `en is missing notify.${key}`);
    assert.match(es, new RegExp(`\\b${key}:`), `es is missing notify.${key}`);
  }
});

test("they resume on boot without asking a second time", () => {
  assert.match(webSrc("main.tsx"), /startAgentNotifications\(\);/);
});

test("the switch is reachable from BOTH surfaces, not just the phone", () => {
  // It shipped in the phone's prefs dialog only — the one surface a person at
  // a desk never opens. There was a switch and no way to reach it from the
  // panel where they actually sit, which is the same as not having built it.
  const desktop = webSrc("components", "settings", "WebPanel.tsx");
  assert.match(desktop, /NotificationSwitch/, "the desktop settings screen offers it");
  assert.match(desktop, /t\("notify\.title"\)/);
  const phone = webSrc("components", "settings", "PanelPrefs.tsx");
  assert.match(phone, /<NotificationSwitch \/>/, "and so does the phone's dialog");
});

// ── Proving it, and offering it ────────────────────────────────────────────
// "On" is a claim until something appears on the glass. Between the browser's
// permission, the OS letting the browser post at all, and a service worker that
// has to be registered, there are three places this dies silently — and the
// switch reads identically in all of them.

test("the test notification goes through the same path the real ones do", () => {
  const notify = webSrc("lib", "notify.ts");
  assert.match(notify, /export async function sendTestNotification\(\): Promise<boolean>/);
  // Through `show()`, not a shortcut: a test that took its own route would
  // prove the route it took. The interesting failures are all inside show().
  assert.match(notify, /await show\(\{/);
  assert.doesNotMatch(notify, /sendTestNotification[\s\S]{0,400}new Notification\(/);
  // It refuses rather than pretending when there is nothing to show it with.
  assert.match(notify, /if \(notifyStance\(\)\.kind !== "on"\) return false;/);

  const prefs = webSrc("components", "settings", "PanelPrefs.tsx");
  assert.match(prefs, /setTested\(await sendTestNotification\(\)\)/);
  assert.match(prefs, /tested === false \? t\("notify\.test_failed"\)/, "a silent failure says so");
});

test("the offer finds you, and cannot open by itself", () => {
  const prefs = webSrc("components", "settings", "PanelPrefs.tsx");
  const inbox = webSrc("screens", "mobile", "MobileChatList.tsx");
  const app = webSrc("App.tsx");

  // A banner with a button, never an automatic prompt: browsers only accept
  // Notification.requestPermission() from a real click, and Chrome drops a
  // request that is not tied to a gesture. So the app asks, and the browser's
  // own dialog comes after the tap.
  assert.match(prefs, /export function NotifyNudge/);
  assert.match(prefs, /onClick=\{async \(\) => \{\s*\n\s*const next = await enableNotifications\(\);/);

  // Only while the browser has not decided. Denied is not something a banner
  // can fix, and off is a decision already made in this very panel.
  assert.match(prefs, /if \(hidden \|\| stance\.kind !== "ask"\) return null;/);
  // Shown once — one that returns every session is an advert.
  assert.match(prefs, /localStorage\.setItem\(NUDGE_DISMISSED, "1"\)/);

  // Both surfaces: a strip on the phone's inbox, a card in the desktop corner.
  assert.match(inbox, /<NotifyNudge \/>/);
  assert.match(app, /<NotifyNudge floating \/>/);
});

test("the tap lands in the shape of the surface that raised it", () => {
  const notify = webSrc("lib", "notify.ts");

  // Two frames, two ways of addressing a session: the phone puts it in the
  // PATH, the desktop panel in the QUERY. Handing out the phone path
  // unconditionally threw a laptop click into the phone surface — one column,
  // no sidebar, on a 27-inch screen you were already sitting in front of.
  assert.match(notify, /function onPhoneSurface\(\): boolean/);
  assert.match(notify, /if \(isInstalled\(\)\) return true;/);
  assert.match(notify, /location\.pathname\.startsWith\("\/mobile"\)/);
  assert.match(notify, /if \(onPhoneSurface\(\)\) return chatPath\(pidOf\(row\), row\.agent_slug, key\);/);
  assert.match(notify, /return `\/p\/\$\{pid\}\/chat\?\$\{q\.toString\(\)\}`/);
  // The desktop route has no "no project" sentinel — the super-agent is in 0.
  assert.match(notify, /const pid = row\.project_id \?\? 0;/);
});

test("a tap that cannot focus still opens something", () => {
  const sw = webPublic("sw.js");
  const pwa = webSrc("lib", "pwa.ts");

  // focus() can be refused — an installed app is not allowed to raise a
  // background browser tab. Returning it either way meant the tap did NOTHING:
  // no focus, and openWindow never reached.
  assert.match(sw, /const focused = await client\.focus\(\);\s*\n\s*if \(focused\) return focused;/);
  assert.match(sw, /\} catch \{ \/\* try the next client, then open a window \*\/ \}/);

  // And the worker script itself is never served from the HTTP cache during an
  // update check: the default lets a browser keep an old sw.js for a day, which
  // is how a device ends up running a worker older than the panel around it.
  assert.match(pwa, /updateViaCache: "none"/);
  assert.match(pwa, /\.then\(\(reg\) => reg\.update\(\)/);
});
