// A group room that is working has to say so on every rail.
//
// A cascade is the longest-running turn shape the daemon has: one owner line
// fans out into several agents, each with a full tool loop. It registered in
// `active-turns` (so Stop could reach it) but broadcast NOTHING, so outside the
// socket of whoever pressed send the room looked idle for minutes — no spinner
// in the Inbox or the Chats sidebar, no unread mark when it finished, and a
// second tab that opened the room mid-cascade had a pending bubble with no
// closing frame that could ever end it.
//
// WHAT IS DELIBERATELY NOT HERE. The room does not push `event` or `delta`.
// `recordActiveTurnEvent` builds one flat timeline, and a cascade is several
// speakers with a bubble each — pushing the steps through it would show a
// follower four agents merged into one bubble, which is a worse lie than "the
// room is busy, here is the thread when it stops". Following a cascade speaker
// by speaker needs the client to split on `speaker_start`, and that is its own
// pass. This test pins BOTH halves: the lifecycle must be there, and the steps
// must not, so the shortcut is not taken by accident later.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("a group cascade broadcasts its whole lifecycle", () => {
  const src = read("src/host/daemon/api/groups.js");
  assert.match(src, /import \{ broadcastTurn \}/, "the room must reach the shared feed");
  assert.match(src, /turnFrame\("start"\)/, "…when it begins");
  assert.match(src, /turnFrame\(stopped \? "aborted" : "final"/, "…when it ends, and which ending");
  assert.match(src, /turnFrame\(stopped \? "aborted" : "error"/, "…including the one that threw");
});

test("a group cascade does NOT push per-step frames", () => {
  const src = read("src/host/daemon/api/groups.js");
  // The shortcut that would look like progress and read as four agents in one
  // bubble. If a future pass teaches the client to split on `speaker_start`,
  // this assertion is what should be deleted — deliberately, with that work.
  assert.doesNotMatch(src, /turnFrame\("event"/, "one flat timeline cannot represent several speakers");
  assert.doesNotMatch(src, /turnFrame\("delta"/);
  // Calls, not prose: the comment above the code names this function to explain
  // why it is absent, and a bare substring check reads that as its presence.
  assert.doesNotMatch(src, /recordActiveTurnEvent\(/, "and nothing may record them into the flat one either");
});

test("the room's ending is the phase the panel already knows", () => {
  // The frames are only worth sending if `chat-activity.ts` classifies them —
  // the same coupling that broke for `event`. `final` and `aborted` are its
  // unread-raising endings, so a cascade that finishes while you are elsewhere
  // leaves the blue dot the 1:1 chats leave.
  const activity = read("src/interfaces/web/src/lib/chat-activity.ts");
  assert.match(activity, /frame\.phase === "final" \|\| frame\.phase === "aborted"/);
});

test("a turn that closes with nothing in it leaves no bubble", () => {
  // The group's `final` carries no result — the room's answer is the speakers'
  // own turns, already on the thread. Without this the follower would be left
  // with a blank assistant bubble at the foot of the room until the silent
  // re-read replaced it.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  const close = hook.slice(hook.indexOf("const closeLive"), hook.indexOf("const onTurnFrame"));
  assert.match(close, /const empty = !closed\.parts\.length && !closed\.media\?\.length/);
  assert.match(close, /if \(empty\) copy\.pop\(\)/);
});
