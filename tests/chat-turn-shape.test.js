// How a web chat turn is shaped: the work collapses into one row, the closing
// message is what you read.
//
// Two regressions live here, both from the same era of "a turn is a flat list
// of parts":
//
//   1. applyStreamEvent appended the final answer only when the turn had NO
//      text part at all. The agent writes a short line before each tool call,
//      so any multi-step turn already had one — and the conclusion was dropped
//      on the floor. The reader saw nine tool cards and no answer.
//   2. MessageBubble rendered every part in sequence, so a 24-step turn was a
//      screenful of alternating bubbles and cards with the answer at the very
//      bottom.
//
// The front end is TypeScript, so these assert on the source the way
// turn-attribution.test.js does for the same reducer.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

const USE_CHAT = web("hooks", "useChat.ts");
const MESSAGE_BUBBLE = web("components", "chat", "MessageBubble.tsx");
const ACTION_GROUP = web("components", "chat", "ActionGroup.tsx");
const EN = web("i18n", "en.ts");
const ES = web("i18n", "es.ts");

test("stream: the closing message is appended unless it was already streamed", () => {
  const final = USE_CHAT.match(/case "final": \{[\s\S]*?\n {4}\}/);
  assert.ok(final, "applyStreamEvent must handle the final event");
  assert.match(
    final[0],
    /p\.kind === "text" && p\.text\.trim\(\) === finalText\.trim\(\)/,
    "the duplicate check compares the TEXT — not merely whether some text exists",
  );
  assert.match(
    final[0],
    /finalText && !alreadyShown\s*\n?\s*\? \[\.\.\.turn\.parts, \{ kind: "text", text: finalText \}\]/,
    "a non-duplicate closing message must be appended as a part",
  );
  assert.doesNotMatch(
    final[0],
    /!turn\.parts\.some\(\(p\) => p\.kind === "text"\)/,
    "the old guard dropped every answer that came after a tool call",
  );
});

test("bubble: the work is grouped, the answer is not", () => {
  assert.match(
    MESSAGE_BUBBLE,
    /const \{ work, rest \} = mine \? \{ work: \[\], rest: msg\.parts \} : splitTurnParts\(msg\.parts\)/,
    "an assistant turn is split into work + answer",
  );
  assert.match(
    MESSAGE_BUBBLE,
    /work\.length > 0 && <ActionGroup parts=\{work\} running=\{!!msg\.pending\} \/>/,
    "the work renders as ONE collapsible group, streaming state included",
  );
  assert.match(MESSAGE_BUBBLE, /\{rest\.map\(/, "only the trailing parts render as bubbles");
});

test("split: the group ends at the last tool, and ask_questions stays out of it", () => {
  const split = ACTION_GROUP.match(/export function splitTurnParts[\s\S]*?\n\}/);
  assert.ok(split, "splitTurnParts must be exported for the bubble to use");
  assert.match(
    split[0],
    /p\.kind === "tool" && p\.tool !== "ask_questions"/,
    "an ask_questions card is a control the user must reach — never grouped away",
  );
  assert.match(split[0], /parts\.slice\(0, lastWork \+ 1\)/);
  assert.match(split[0], /parts\.slice\(lastWork \+ 1\)/);
  assert.match(
    split[0],
    /if \(lastWork < 0\) return \{ work: \[\], rest: parts \}/,
    "a turn with no tools keeps rendering exactly as before",
  );
});

test("group: open while it works, collapsed when done, and failures are named", () => {
  assert.match(
    ACTION_GROUP,
    /const open = manual \?\? \(!!running \|\| hasAsk\)/,
    "streaming turns stay open; a reader's click wins from then on",
  );
  assert.match(ACTION_GROUP, /status === "error"/, "the header must count failed calls");
  assert.match(
    ACTION_GROUP,
    /t\("shared_ui\.tools_failed", \{ n: failed \}\)/,
    "…and say so in the collapsed header, or an error hides behind a chevron",
  );
});

test("i18n: the actions label exists in both languages", () => {
  for (const [name, src] of [["en", EN], ["es", ES]]) {
    assert.match(src, /actions_count:\s+"\{n\} /, `${name}.ts must define chat_ui.actions_count`);
  }
});
