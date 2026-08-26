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
    /finalText && !alreadyShown\s*\n?\s*\? \[\.\.\.parts, \{ kind: "text", text: finalText \}\]/,
    "a non-duplicate closing message must be appended as a part",
  );
  assert.match(
    final[0],
    /last\.kind === "text" && last\.streaming/,
    "a segment still being streamed is REPLACED by the cleaned text, not left above it",
  );
  assert.doesNotMatch(
    final[0],
    /!turn\.parts\.some\(\(p\) => p\.kind === "text"\)/,
    "the old guard dropped every answer that came after a tool call",
  );
});

// Token streaming arrived after the shape above was settled: the same answer
// now reaches the reducer twice — once as `assistant_delta` tokens, once whole
// as `assistant_text`/`final`. Whoever closes the segment must REPLACE the
// streamed part; appending it prints the answer twice.
test("stream: streamed tokens are replaced by the closing segment, never doubled", () => {
  const deltas = USE_CHAT.match(/default: \{[\s\S]*?\n {4}\}/);
  assert.ok(deltas, "applyStreamEvent must handle raw deltas");
  assert.match(
    deltas[0],
    /streaming: true/,
    "a part built from deltas is marked streaming, so the closing segment can find it",
  );
  assert.match(
    deltas[0],
    /last\.kind === "text" && last\.streaming/,
    "tokens only extend a part still streaming — a closed segment never absorbs the next one's",
  );

  const closed = USE_CHAT.match(/case "assistant_text": \{[\s\S]*?\n {4}\}/);
  assert.ok(closed, "applyStreamEvent must handle assistant_text");
  assert.match(
    closed[0],
    /parts\[parts\.length - 1\] = \{ kind: "text", text: ev\.text \}/,
    "the cleaned segment replaces the streamed one in place",
  );
});

// The thinking is rendered on purpose, in its own block — the fix for it
// arriving spliced into the answer as <think>…</think>. It must never be read
// as something the agent said: not copied, not counted as the reply.
test("thinking: its own block, and never part of the answer", () => {
  assert.match(
    USE_CHAT,
    /export interface ReasoningPart/,
    "a reasoning part is a kind of its own, not a text part",
  );
  assert.match(
    USE_CHAT,
    /\.filter\(\(p\): p is TextPart => p\.kind === "text"\)/,
    "textOf keeps reading only text parts — reasoning is not the reply",
  );
  assert.match(
    MESSAGE_BUBBLE,
    /part\.kind === "reasoning" \? \(\s*\n?\s*<ReasoningBlock/,
    "the bubble renders reasoning through ReasoningBlock, not as a text bubble",
  );
  const reasoning = USE_CHAT.match(/case "assistant_reasoning": \{[\s\S]*?\n {4}\}/);
  assert.ok(reasoning, "applyStreamEvent must handle the consolidated reasoning event");
  assert.match(
    reasoning[0],
    /p\.kind === "reasoning" && p\.streaming/,
    "the consolidated block closes the streamed one instead of adding a second",
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
    /showTools && !mine && work\.length > 0 && <ActionGroup parts=\{work\} running=\{!!msg\.pending\} \/>/,
    "the work renders as ONE collapsible group when showTools is on",
  );
  assert.match(MESSAGE_BUBBLE, /\(simpleParts \|\| rest\)\.map\(/, "simple view flattens; full view uses rest");
});

test("bubble: simple view lifts narration out of the work block", () => {
  assert.match(
    MESSAGE_BUBBLE,
    /showTools\?: boolean/,
    "MessageBubble accepts a showTools layout flag",
  );
  assert.match(
    MESSAGE_BUBBLE,
    /p\.kind === "tool" && p\.tool === "ask_questions"/,
    "simple view still surfaces ask_questions — it is a control, not a log line",
  );
  assert.match(
    MESSAGE_BUBBLE,
    /simpleParts = !mine && !showTools/,
    "simple view builds a flat part list without the ActionGroup",
  );
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
    assert.match(src, /show_tools:\s+"/, `${name}.ts must define chat_ui.show_tools`);
  }
});
