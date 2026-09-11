// Two ways of saying "do not interrupt", and the bug that made the second one
// a lie.
//
// 1. THE SHORTCUT. The send-mode toggle answers "what does Enter usually mean
//    here", and it is a real question with two real answers: writing during a
//    turn almost always means "no, stop, do this instead" (which is what
//    Telegram has always done), and sometimes means "finish that, then do this".
//    What was missing was a way to mean the careful one ON PURPOSE, without
//    walking to a switch, flipping it, coming back, sending, and remembering to
//    flip it back — four actions to avoid interrupting one turn. Ctrl/Cmd+Enter
//    is that, and it is ONE-DIRECTIONAL: it can only ever make a send gentler
//    than the toggle, never sharper. A modifier that could interrupt is a
//    modifier you have to think about before pressing.
//
// 2. THE QUEUE THAT DID NOT HOLD. Manu queued a message, walked away, came back
//    and it had gone out on top of the running turn. Same root cause as the
//    invisible a2a turn: `chat-activity.ts` treated the `event` frames arriving
//    while he was away as the turn ENDING, which put its id in `closedTurnIds`;
//    on return `loadThread` discarded the daemon's live `active_turn` as stale,
//    `following` went false, and the drain — which correctly refuses to run on
//    top of a live turn — no longer believed there was one. Fixed in
//    chat-activity.ts; pinned here from the other side, because the queue is
//    where it was felt and where a future regression would show.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = (...p) => fs.readFileSync(path.join(ROOT, "src/interfaces/web/src", ...p), "utf8");

test("ctrl/cmd+enter queues; plain enter obeys the toggle", () => {
  const input = web("components", "ui", "chat-input.tsx");
  assert.match(input, /onSubmit\(\{ queue: e\.ctrlKey \|\| e\.metaKey \}\)/);
  // Both modifiers: the same person uses both platforms, and a shortcut that
  // works on one machine and silently interrupts on the other is worse than not
  // having it.
  assert.match(input, /e\.ctrlKey \|\| e\.metaKey/);
  // Shift+Enter is still a newline, not a send.
  assert.match(input, /e\.key === "Enter" && !e\.shiftKey/);
  // The send BUTTON must not pass its MouseEvent in as the options object.
  assert.match(input, /onClick=\{\(\) => onSubmit\(\)\}/);
});

test("the shortcut reaches the send, through every layer", () => {
  // Composer → ChatTab → useChat. A prop dropped anywhere in between would make
  // the shortcut silently do nothing, which is the failure mode worth a test:
  // it looks like it worked until an answer gets cut in half.
  assert.match(web("components", "chat", "Composer.tsx"),
    /onSend: \(text: string, media\?: UploadedMedia\[\], opts\?: \{ queue\?: boolean \}\)/);
  assert.match(web("components", "chat", "Composer.tsx"),
    /await onSend\(body, media\.length \? media : undefined, opts\)/);
  const tab = web("screens", "project", "ChatTab.tsx");
  assert.match(tab, /const send = async \(text: string, media\?: UploadedMedia\[\], opts\?: \{ queue\?: boolean \}\)/);
  assert.equal((tab.match(/\.\.\.\(opts\?\.queue \? \{ queue: true \} : \{\}\)/g) || []).length, 2,
    "both the super-agent and the project-agent branch");
});

test("the shortcut can only soften a send, never sharpen it", () => {
  const hook = web("hooks", "useChat.ts");
  // `queue: true` suppresses the interrupt. There is deliberately no
  // `queue: false` that could FORCE one from a queueing toggle.
  assert.match(hook, /if \(!queueOnSendRef\.current && !opts\.queue\) void stopTurn\(\);/);
  assert.doesNotMatch(hook, /opts\.queue === false/);
  assert.doesNotMatch(hook, /opts\.interrupt/);
});

test("the shortcut is written down where the mode is chosen", () => {
  // A shortcut nobody can discover is a shortcut nobody uses. The toggle's
  // tooltip is the one place the question is already being answered.
  for (const lang of ["es", "en"]) {
    const src = fs.readFileSync(path.join(ROOT, `src/interfaces/web/src/i18n/${lang}.ts`), "utf8");
    const tips = src.match(/send_mode_tip_\w+:\s*"[^"]*"/g) || [];
    assert.equal(tips.length, 2, `${lang}: both tooltips`);
    for (const tip of tips) assert.match(tip, /Ctrl\+Enter/, `${lang}: ${tip}`);
  }
});

test("a queued turn is not released by walking away and back", () => {
  // The drain refuses to run on top of a live turn — that part was always
  // right. What broke was the pane's BELIEF that one was live, on re-entry.
  const hook = web("hooks", "useChat.ts");
  const drain = hook.slice(hook.indexOf("const drainQueue"), hook.indexOf("drainQueueRef.current = drainQueue"));
  assert.match(drain, /streamingRef\.current \|\| followingRef\.current/);

  // Re-entry asks the daemon whether a turn is running, and only discards that
  // answer for a turn whose CLOSING frame this tab has actually seen.
  assert.equal((hook.match(/!isChatTurnClosed\(detail\.active_turn\?\.turn_id\)/g) || []).length, 2,
    "both load() and loadThread()");

  // …and what counts as a closing frame is the list in chat-activity.ts, which
  // is where the bug was: an `event` is a step, so seeing one must NOT retire
  // the turn. (tests/turn-phases.test.js owns that contract; this asserts the
  // coupling, so deleting it there cannot quietly un-fix this.)
  const activity = web("lib", "chat-activity.ts");
  assert.match(activity, /IN_FLIGHT_PHASES\.has\(frame\.phase\)/);
  assert.match(activity, /const IN_FLIGHT_PHASES = new Set\(\[[^\]]*"event"/);
});
