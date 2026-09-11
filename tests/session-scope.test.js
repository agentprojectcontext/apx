// The session switcher stays inside the CHAT you have open, not the pane.
//
// A session is "the same conversation, another day". Which sessions the
// switcher may offer is therefore a property of the conversation — its channel,
// and its person where the channel carries several — and it was a property of
// the SURFACE (`channelScope`). Every answer that gave was wrong:
//
//   · /inbox passed "web", so opening a WhatsApp thread listed web sessions and
//     the thread you were actually reading was missing from its own switcher
//   · the phone passed nothing to escape that, so opening Rodri's WhatsApp
//     offered every thread APX has — Telegram days, the log, the CLI, and four
//     other people's WhatsApp conversations, in one menu
//   · /p/:pid/chat passed nothing at all, so the same conversation opened from
//     the project and from the inbox showed two different lists
//
// The three links Manu compared are all the same component. The prop was the
// last place a pane could still disagree with the chat inside it, so it is gone
// rather than made consistent: there is nothing left to pass differently.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = (...p) => fs.readFileSync(path.join(ROOT, "src/interfaces/web/src", ...p), "utf8");
const { chatScope } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/chat-scope.ts")
);

test("an open thread scopes to its own channel and person", () => {
  const scope = chatScope({ kind: "thread", channel: "whatsapp", threadId: "2026-09-11~rodri" });
  assert.equal(scope.channel, "whatsapp");
  assert.equal(scope.threadId, "2026-09-11~rodri");
  assert.equal(scope.contact, "rodri", "one person's days, not everyone who wrote in");
});

test("a stored conversation scopes to the channel the FILE says", () => {
  // Not the pane's. This is the case that had no answer at all before: a
  // conversation is `{kind:"conv"}`, so the old code fell through to the
  // surface's channel — undefined inside a project, which meant no scope.
  const scope = chatScope({ kind: "conv", agentSlug: "rocky", convId: "web-main" }, "telegram");
  assert.equal(scope.channel, "telegram");
});

test("a session with no history yet is scoped to where its first message will go", () => {
  // A live session has nothing to be inside. Its sends leave on `web`, so that
  // is the honest scope — and it is the same answer on all three surfaces now,
  // rather than "web" on two of them and "everything" on the third.
  assert.equal(chatScope({ kind: "live", agentSlug: "rocky" }).channel, "web");
  assert.equal(chatScope({ kind: "live", agentSlug: "rocky" }, "web").channel, "web");
});

test("no surface passes a channel of its own any more", () => {
  for (const file of [
    ["screens", "InboxScreen.tsx"],
    ["screens", "mobile", "MobileChat.tsx"],
    ["screens", "project", "ChatTab.tsx"],
  ]) {
    assert.doesNotMatch(web(...file), /channelScope=/, `${file.join("/")} must not scope the switcher`);
  }
  // What ChatTab hands the picker instead: the loaded conversation's own channel.
  assert.match(web("screens", "project", "ChatTab.tsx"), /chatChannel=\{shownChannel\}/);
});

test("a menu whose only row is the chat you are reading shows nothing", () => {
  // "If there is nothing more than this session, none is shown." A one-row menu
  // that offers where you already are reads as a list that failed to load.
  const picker = web("components", "chat", "SessionPicker.tsx");
  assert.match(picker, /all\.length === 1 && all\[0\]\.id === current \? \[\] : all/);
  // …and the empty state keys off what is actually rendered, not off the fetch.
  assert.match(picker, /sessions\.data && !rows\.length/);
});

test("a new session cannot move you to another channel", () => {
  // "New session" is `{kind:"live"}`, and a live session's first message goes
  // out on web — the only channel this panel can start a conversation on. From
  // a Telegram day or an a2a pair it therefore used to teleport you to a web
  // chat with the same agent, under a header that changed out from under you.
  const tab = web("screens", "project", "ChatTab.tsx");
  assert.match(tab, /const startsOnWeb = shownChannel === "web"/);
  assert.match(tab, /disabled: streaming \|\| msgs\.length === 0 \|\| !startsOnWeb/);
  // Disabled WITH a reason, not greyed out in silence.
  assert.match(tab, /t\("project\.chat\.new_session_channel", \{ channel: shownChannel \}\)/);
});
