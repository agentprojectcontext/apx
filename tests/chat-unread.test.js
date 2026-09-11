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
// last utterance (`preview_at`) is newer than the last one this device saw.
// Whoever wrote it, however it ran.
//
// The contracts below are the ones that broke or would break silently:
//   · it must key off preview_at, never last_activity_at — activity also moves
//     for your OWN send and for every tool row of a turn (560 of them on one
//     busy Telegram day), so the dot would light the moment you pressed enter
//   · it must take a baseline before anything counts, or a fresh browser shows
//     a badge of 74 for conversations you have already read
//   · the row's identity must be the SHARED one, or a row is read under one key
//     and drawn under another
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

test("a device takes a baseline before anything counts as unread", () => {
  const read = webSrc("lib", "chat-read.ts");
  assert.match(read, /if \(!s\.seeded\) return false;/, "nothing is news before the first pass");
  assert.match(read, /s\.seeded = true;/, "and the first pass with rows in hand sets it");
  // An empty list is not a baseline: seeding off it would mark every row that
  // arrives afterwards as new.
  assert.match(read, /if \(!rows\.length\) return;/);
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
