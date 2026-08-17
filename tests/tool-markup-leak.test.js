// Internal tool markup must never reach the user, and a tool call written as
// prose must be EXECUTED rather than printed.
//
// The failure this covers, end to end: history that contains a worked example
// of a tool call written as text teaches the model to write calls instead of
// making them. The loop then sees no tool_calls, treats the transcript as the
// final answer, and the user receives:
//
//   [tool call: run_shell] {"command":"git branch -a","cwd":".","project":"apx"}
//
// Two defences. The history no longer carries that shape (gemini.js drops an
// unreplayable call instead of transcribing it), and if a model produces it
// anyway the parser turns it back into a real call.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractPseudoToolCalls,
  cleanTextOfPseudoToolCalls,
} from "#core/agent/tools/tool-call-parser.js";
import gemini from "#core/engines/gemini.js";

test("a tool call written as prose is parsed into a real call", () => {
  const text = '[tool call: run_shell] {"command":"git branch -a","cwd":".","project":"apx"}';
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 1, "exactly one call, not one per JSON blob");
  assert.equal(calls[0].function.name, "run_shell");
  assert.deepEqual(calls[0].function.arguments, {
    command: "git branch -a",
    cwd: ".",
    project: "apx",
  });
});

test("the whole line is removed from what the user sees, brackets included", () => {
  const text =
    'Dale, miro el repo.\n[tool call: run_shell] {"command":"git log -n 5","cwd":"."}\nYa te cuento.';
  const clean = cleanTextOfPseudoToolCalls(text);
  assert.ok(!clean.includes("tool call"), `markup survived: ${clean}`);
  assert.ok(!clean.includes("git log"), `arguments survived: ${clean}`);
  assert.match(clean, /Dale, miro el repo/);
  assert.match(clean, /Ya te cuento/);
});

test("a malformed argument blob is still not shown to the user", () => {
  const calls = extractPseudoToolCalls('[tool call: list_projects] {broken');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, "list_projects");
  assert.deepEqual(calls[0].function.arguments, {});
});

test("several calls in one message all fire", () => {
  const text =
    '[tool call: list_projects] {}\n[tool call: run_shell] {"command":"ls"}';
  const calls = extractPseudoToolCalls(text);
  assert.deepEqual(calls.map((c) => c.function.name), ["list_projects", "run_shell"]);
});

test("the history annotation for a stale turn is never spoken", () => {
  const clean = cleanTextOfPseudoToolCalls(
    "[omitted: this turn contained data that may be stale — call the tool again instead of repeating it] Hola Manu."
  );
  assert.equal(clean, "Hola Manu.");
});

// ── the source of the contamination ────────────────────────────────────────

function stubFetch() {
  const captured = {};
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: {},
      }),
    };
  };
  return { captured, restore: () => { global.fetch = original; } };
}

test("gemini history never transcribes a tool call the model could copy", async () => {
  const { captured, restore } = stubFetch();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "mirá el repo" },
        {
          // Unsignable turn: nothing to replay, so the call is dropped.
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "p_1", type: "function", function: { name: "run_shell", arguments: '{"command":"git log"}' } },
          ],
        },
        { role: "tool", tool_call_id: "p_1", tool_name: "run_shell", content: "abc123 fix" },
        { role: "user", content: "¿y?" },
      ],
      model: "gemini-3.5-flash",
      config: { api_key: "test-key" },
      tools: [{ type: "function", function: { name: "run_shell", parameters: {} } }],
    });
    const everyText = captured.body.contents
      .flatMap((c) => c.parts)
      .map((p) => p.text || "")
      .join("\n");
    assert.ok(
      !/\[tool call:/i.test(everyText),
      `history teaches the model to write calls as text:\n${everyText}`
    );
    // The result still reaches the model — dropping the call must not drop
    // what the tool found.
    assert.match(everyText, /abc123 fix/);
  } finally {
    restore();
  }
});
