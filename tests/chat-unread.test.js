// A dot on the row, and a number on the rail, for work you did not start.
//
// THE GAP THIS EXISTS FOR. `lib/chat-activity.ts` is the live registry: it
// listens to turn frames and marks a conversation unread when one it was
// WATCHING ends out of view. That is the right answer for a turn you sent from
// another tab, and no answer at all for the rest — a routine that wakes at nine
// and posts its report, a task an agent finishes on its own, a peer replying
// over a2a. golf-coach filed three reports and every rail stayed blank.
//
// `lib/chat-read.ts` answers the other half from the row itself: the agent's
// last utterance (`preview_at`) is newer than the last one anybody read.
// Whoever wrote it, however it ran.
//
// AND IT IS THE DAEMON'S ANSWER, NOT THIS BROWSER'S. The marks used to live in
// `localStorage`, one copy per device, which meant an afternoon of reading on
// the laptop left forty blue rows on the phone — every one of them already
// read. They live in `~/.apx/read-marks.json` now (core/stores/read-marks.js,
// covered by tests/read-marks.test.js); what is left on the device is a
// one-request bridge so the dot goes out on the click rather than on the next
// fetch.
//
// The contracts below are the ones that broke or would break silently:
//   · it must key off preview_at, never last_activity_at — activity also moves
//     for your OWN send and for every tool row of a turn (560 of them on one
//     busy Telegram day), so the dot would light the moment you pressed enter
//   · the mark must be SENT, and the row's own `unread` believed, or the panel
//     grows a second opinion and the two devices drift apart again
//   · the row's identity must be the SHARED one, or a row is read under one key
//     and drawn under another
//   · the live registry's private dot must be droppable from outside, or the
//     tab that watched a turn end keeps a mark the rest of the install cleared
//   · the count must obey the same filters the list does, or you get a badge
//     for a channel you have hidden and no way to clear it
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = (...p) => fs.readFileSync(path.join(ROOT, "src/interfaces/web/src", ...p), "utf8");

test("unread is decided by what the AGENT said, not by activity", () => {
  const read = webSrc("lib", "chat-read.ts");
  assert.match(read, /row\.preview_at \|\| ""/, "the agent's last utterance is the clock");
  assert.doesNotMatch(
    read.slice(read.indexOf("function stampOf")),
    /last_activity_at/,
    "activity moves for your own send and for every tool row — never key off it",
  );
});

test("read state is the daemon's, not this browser's", () => {
  const read = webSrc("lib", "chat-read.ts");
  // The regression in one line: a device that remembers on its own is a device
  // the other one cannot correct.
  assert.doesNotMatch(
    read,
    /localStorage\.(get|set|remove)Item/,
    "marks must not go back into per-device storage — that is the bug, not the fix",
  );
  assert.match(read, /Inbox\.markRead\(/, "reading is reported to the daemon");
  assert.match(read, /row\.unread === true/, "and the row's own answer is what the dot reads");

  // The row carries it, and the daemon is what puts it there.
  assert.match(webSrc("lib", "api", "inbox.ts"), /unread\?: boolean/);
  const route = fs.readFileSync(path.join(ROOT, "src/host/daemon/api/inbox.js"), "utf8");
  assert.match(route, /decorateUnread\(merged, marks\)/, "every listed row is stamped");
  assert.match(route, /api\.post\("\/inbox\/read"/, "and there is somewhere to report a read");
});

test("reading marks read — including the pane already on screen", () => {
  const read = webSrc("lib", "chat-read.ts");
  assert.match(read, /urlLooksAt\(window\.location\.href, row\)/, "all three surfaces, one rule");
  // The inbox keeps its selection in state, not in the URL, so it has to say so.
  const inbox = webSrc("screens", "InboxScreen.tsx");
  assert.match(inbox, /markRowRead\(fresh \|\| selected\)/);
  // And every list that lands feeds the marks, so the rail can count on screens
  // that never mount an inbox.
  assert.match(webSrc("hooks", "useInbox.ts"), /syncReadMarks\(data \?\? \[\]\)/);
});

test("a read somewhere else clears the dot this device raised on its own", () => {
  // chat-activity only ever hears turn frames, so it cannot know the phone
  // opened the chat. chat-read does — the daemon puts it on the row — and drops
  // the private mark for it. Without this the laptop keeps a dot forever.
  const read = webSrc("lib", "chat-read.ts");
  assert.match(read, /markActivityRead\(activityKeyForRow\(row\)\)/);
  const activity = webSrc("lib", "chat-activity.ts");
  assert.match(activity, /export function markActivityRead/);
  // One key expression, shared — a second copy is how one rail stops matching
  // the frames the other one is keyed by.
  assert.match(activity, /export function activityKeyForRow/);
  assert.match(webSrc("components", "inbox", "InboxRowItem.tsx"), /activityKeyForRow\(row\)/);

  // And the other device hears about it without waiting for the 15s poll.
  const ws = fs.readFileSync(path.join(ROOT, "src/host/daemon/events-ws.js"), "utf8");
  assert.match(ws, /export function broadcastReadMarks/);
  assert.match(webSrc("lib", "live.ts"), /frame\.type === "read"/);
});

test("the dot and the badge are the same fact, drawn twice", () => {
  const row = webSrc("components", "inbox", "InboxRowItem.tsx");
  assert.match(row, /const unread = useRowUnread\(row\)/);
  assert.match(row, /<ChatRowActivity[^>]*unread=\{unread\}/s, "the row's dot");

  const mark = webSrc("components", "chat", "ChatRowActivity.tsx");
  assert.match(mark, /activity\.unread \|\| unread/, "either source lights it");
  assert.match(mark, /bg-blue-500/);

  const rail = webSrc("components", "layout", "ProjectSidebar.tsx");
  assert.match(rail, /badge=\{unreadChats\}/, "the number on Chats");
  const phone = webSrc("screens", "mobile", "MobileTabBar.tsx");
  assert.match(phone, /badge: unreadChats/, "and on the phone's tab, which shipped a hardcoded 0");
});

test("the count obeys the filters the list obeys", () => {
  const hook = webSrc("hooks", "useChatRead.ts");
  assert.match(hook, /channelEnabledIn\(view\.prefs, "view", r\.channel\)/);
  assert.match(hook, /projectEnabledIn\(scope\.prefs, r\.project_id\)/);
});
