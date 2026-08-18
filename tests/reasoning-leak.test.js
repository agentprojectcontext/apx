// A model that emits its chain-of-thought as the answer must never have it
// forwarded to a user-facing channel.
//
// This is not hypothetical: openrouter:openrouter/free answered a real Telegram
// turn with 668 tokens of "We need to produce a response to user request…" in
// English, where the user expected two sentences of Spanish. Tagged <think>
// blocks were already stripped; untagged planning was not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitThinking, stripThinking, stripReasoning, looksLikeUntaggedReasoning } from "#core/util/thinking.js";

const REAL_LEAK = `We need to produce a response to user request: "Tengo que hacer unas pruebas y tengo que hacer merge".

Interpretation: The user says they need to do some tests and need to do a merge; first they need to test.

As chief of staff, we need to record tasks/commitments, warn about pending items if needed.`;

test("the untagged dump that actually shipped is caught", () => {
  assert.equal(looksLikeUntaggedReasoning(REAL_LEAK), true);
  const { answer, leaked } = stripReasoning(REAL_LEAK);
  assert.equal(leaked, true);
  assert.equal(answer, "", "a leak yields no answer — the caller falls back, never forwards notes");
});

test("ordinary replies are untouched, in either language", () => {
  for (const reply of [
    "Listo, anoté la tarea de merge en acme.dev para mañana.",
    "Filed it under acme.dev, due tomorrow. Nothing else is overdue.",
    "No hay actividad registrada en northwind desde el 3 de agosto.",
  ]) {
    const { answer, leaked } = stripReasoning(reply);
    assert.equal(leaked, false, `false positive on: ${reply}`);
    assert.equal(answer, reply);
  }
});

// The detector must not fire on a real answer that merely starts with "We need".
test("a genuine reply that opens with 'We need to' survives", () => {
  const real =
    "We need to ship this by Friday, so I moved the review earlier. " +
    "Nothing else changed on your side today, and everything else is on track.";
  assert.equal(stripReasoning(real).leaked, false);
});

test("short text is never treated as a dump", () => {
  assert.equal(looksLikeUntaggedReasoning("We need to produce a response"), false);
});

test("tagged thinking is still split, and combines with the untagged check", () => {
  const tagged = "<think>planning here</think>Listo, lo anoté.";
  assert.equal(stripThinking(tagged), "Listo, lo anoté.");
  assert.equal(splitThinking(tagged).thinking, "planning here");

  const both = `<think>first pass</think>${REAL_LEAK}`;
  const out = stripReasoning(both);
  assert.equal(out.leaked, true);
  assert.match(out.thinking, /first pass/, "tagged reasoning is preserved for the log");
});

// Coverage, not just Telegram. Any surface that shows model text to a human
// must route it through the same guard — voice worst of all, since a dump gets
// read aloud at length in the wrong language.
test("every human-facing surface strips reasoning", async () => {
  const fs = await import("node:fs");
  const surfaces = [
    "src/core/channels/telegram/reply.js",
    "src/host/daemon/plugins/desktop/index.js",
    "src/host/daemon/api/voice.js",
  ];
  for (const f of surfaces) {
    const src = fs.readFileSync(f, "utf8");
    assert.match(src, /stripReasoning|stripThinking/, `${f} forwards model text without stripping reasoning`);
  }
});
