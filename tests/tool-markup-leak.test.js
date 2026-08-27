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
import { runAgent } from "#core/agent/run-agent.js";

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

test("DeepSeek DSML markup is parsed into real tool calls", () => {
  const text = `I'll start by reading my notes.
<||DSML||tool_calls>
<||DSML||invoke name="read_file">
<||DSML||parameter name="path" string="true">work/notes.md</||DSML||parameter>
</||DSML||invoke>
<||DSML||invoke name="read_file">
<||DSML||parameter name="path" string="true">work/LEDGER.md</||DSML||parameter>
</||DSML||invoke>
</||DSML||tool_calls>`;
  const calls = extractPseudoToolCalls(text);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].function.name, "read_file");
  assert.deepEqual(calls[0].function.arguments, { path: "work/notes.md" });
  assert.equal(calls[1].function.name, "read_file");
  assert.deepEqual(calls[1].function.arguments, { path: "work/LEDGER.md" });
});

test("DSML markup is stripped from the visible reply", () => {
  const text = `Voy a leer el ledger.
<||DSML||tool_calls>
<||DSML||invoke name="read_file">
<||DSML||parameter name="path" string="true">work/LEDGER.md</||DSML||parameter>
</||DSML||invoke>
</||DSML||tool_calls>`;
  const clean = cleanTextOfPseudoToolCalls(text);
  assert.ok(!clean.includes("DSML"), `markup survived: ${clean}`);
  assert.ok(!clean.includes("read_file"), `tool name survived: ${clean}`);
  assert.match(clean, /Voy a leer el ledger/);
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

// ── the 2026-08-26 leak: the message store's own history shape ─────────────
//
// Between 2026-08-19 (efeade3, which put tool RESULTS in context — the right
// fix) and 2026-08-26, `getRecentChannelTurnsFromFs` rendered every past tool
// record onto the ASSISTANT side as
//
//   [tool run_shell] {"command":"…"} → <output>
//
// A call, written as prose, in the model's own voice, once per tool it had
// ever run. gemini-3.7-flash learned it in four days and started answering in
// it: fourteen turns in one day where the loop saw no tool_calls, took the
// transcript for the final answer, and sent it. Nothing ran — and where the
// model also copied a `→ <result>`, the user was handed a stale result as a
// fresh one.
//
// Neither existing defence covered it: the parser knew `[tool call: NAME]`
// and the cleaner knew `[tool result: NAME]`. This shape fell between them.

const LEAK_2608 =
  'Reviso los workflows de las otras apps para confirmarte. ' +
  '[tool run_shell] {"command":"head -n 10 /path/to/repo/.github/workflows/*.yml"} → ' +
  '==> /path/to/repo/.github/workflows/ci.yml <== name: CI on: push';

test("the store's own history shape is executed, not printed", () => {
  const calls = extractPseudoToolCalls(LEAK_2608);
  assert.equal(calls.length, 1, "exactly one call, not one per JSON blob");
  assert.equal(calls[0].function.name, "run_shell");
  assert.deepEqual(calls[0].function.arguments, {
    command: "head -n 10 /path/to/repo/.github/workflows/*.yml",
  });
});

test("the result the model copied along with it is never shown", () => {
  const clean = cleanTextOfPseudoToolCalls(LEAK_2608);
  assert.doesNotMatch(clean, /\[tool /, `markup survived: ${clean}`);
  assert.doesNotMatch(clean, /head -n 10/, `arguments survived: ${clean}`);
  assert.doesNotMatch(clean, /name: CI/, `a stale result was passed off as fresh: ${clean}`);
  assert.match(clean, /Reviso los workflows/, "the human sentence survives");
});

test("a bare `[tool NAME]` with no arguments is not spoken either", () => {
  const clean = cleanTextOfPseudoToolCalls("Reviso los MCPs configurados.\n[tool list_mcps]");
  assert.equal(clean, "Reviso los MCPs configurados.");
});

test("prose about a tool is prose — no arguments, no call", () => {
  // The bare form only counts as a call when an argument object follows it.
  const text = "El [tool run_shell] no anduvo, tiró exit 127.";
  assert.deepEqual(extractPseudoToolCalls(text), []);
});

test("a record annotation is scrubbed but never re-executed", () => {
  // `[tool result: …]` describes something that already ran. Re-running an old
  // shell command because the model quoted it is not a recovery.
  const text = 'Ya lo miré.\n[tool result: run_shell] (command=rm -rf /path/to/build) → ok';
  assert.deepEqual(extractPseudoToolCalls(text), [], "an annotation must not fire");
  const clean = cleanTextOfPseudoToolCalls(text);
  assert.equal(clean, "Ya lo miré.");
});

// ── the loop, end to end ───────────────────────────────────────────────────
//
// The parser knowing the shape is only half of it: the recovered call has to
// reach the tool, and the transcript has to die before the surface sends it.
// This drives the real loop with an engine that writes the call as prose.

test("a call written as prose runs, and none of it is spoken", async () => {
  const calls = [];
  const events = [];
  const out = await runAgent({
    globalConfig: { super_agent: { enabled: true, model: "mock", permission_mode: "total" } },
    system: "you are a test agent",
    toolSchemas: [{
      type: "function",
      function: { name: "list_agents", description: "List agents", parameters: { type: "object", properties: {} } },
    }],
    makeToolHandlers: () => ({ list_agents: async (a) => { calls.push(a); return { agents: ["ada"] }; } }),
    toolHandlerCtx: {},
    onEvent: (e) => events.push(e),
    maxIters: 6,
    prompt: "listá los agentes [mock:prose:list_agents]",
  });

  assert.equal(calls.length, 1, "the tool the prose stood in for actually ran");
  assert.deepEqual(calls[0], { project: "acme" }, "with the arguments it was written with");
  assert.ok(
    events.some((e) => e.type === "tool_calls_recovered" && e.from === "pseudo"),
    "the recovery is surfaced, not silent",
  );
  assert.doesNotMatch(out.text, /\[tool /, `markup reached the user: ${out.text}`);
  assert.doesNotMatch(out.text, /ya estaba hecho/, "a stale result must not be passed off as fresh");
});
