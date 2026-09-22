// Tests for engines/ollama.js — specifically the tool_choice handling.
//
// Ollama's /api/chat does not honor a real tool_choice field, so when the
// caller asks to force a tool call ("required" / "any") we inject a strong
// system-message hint instead. These tests verify that:
//   - the hint is injected when forceTool conditions hold
//   - the hint is NOT injected for "auto" / undefined
//   - the original system prompt is preserved when present
//   - no hint is injected when there are no tools (forceTool is meaningless)
//
// We stub global.fetch so the tests run without an Ollama server.

import { test } from "node:test";
import assert from "node:assert/strict";
import ollama from "#core/engines/ollama.js";

function stubFetchCapturingBody() {
  const captured = {};
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        message: { role: "assistant", content: "ok" },
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    };
  };
  return {
    captured,
    restore: () => { global.fetch = original; },
  };
}

test("ollama: toolChoice='required' injects force-tool hint into system", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      system: "You are an agent.",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2:1b",
      tools: [{ type: "function", function: { name: "list_projects", parameters: {} } }],
      toolChoice: "required",
    });
    const sysMsg = captured.body.messages.find((m) => m.role === "system");
    assert.ok(sysMsg, "system message must be present");
    assert.match(sysMsg.content, /You are an agent\./, "preserves original system");
    assert.match(sysMsg.content, /MUST call one of the available tools/i, "injects force-tool hint");
    assert.match(sysMsg.content, /no 'ok', 'sure'/i, "warns against ghost acks");
  } finally {
    restore();
  }
});

test("ollama: toolChoice='any' also injects the hint", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2:1b",
      tools: [{ type: "function", function: { name: "list_projects", parameters: {} } }],
      toolChoice: "any",
    });
    const sysMsg = captured.body.messages.find((m) => m.role === "system");
    assert.ok(sysMsg);
    assert.match(sysMsg.content, /MUST call one of the available tools/i);
  } finally {
    restore();
  }
});

test("ollama: toolChoice='auto' does NOT inject the hint", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2:1b",
      tools: [{ type: "function", function: { name: "list_projects", parameters: {} } }],
      toolChoice: "auto",
    });
    const sysMsg = captured.body.messages.find((m) => m.role === "system");
    assert.equal(sysMsg.content, "be brief");
  } finally {
    restore();
  }
});

test("ollama: no toolChoice + no tools → no system hint, original system preserved", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2:1b",
    });
    const sysMsg = captured.body.messages.find((m) => m.role === "system");
    assert.equal(sysMsg.content, "be brief");
    assert.equal(captured.body.tools, undefined, "no tools key when none passed");
  } finally {
    restore();
  }
});

test("ollama: toolChoice='required' with NO tools → no hint (force is meaningless)", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      system: "be brief",
      messages: [{ role: "user", content: "hi" }],
      model: "llama3.2:1b",
      toolChoice: "required",
    });
    const sysMsg = captured.body.messages.find((m) => m.role === "system");
    assert.equal(sysMsg.content, "be brief", "hint only injected when tools are present");
  } finally {
    restore();
  }
});

test("ollama: tool_calls and tool_name from prior turns are forwarded unchanged", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      messages: [
        { role: "user", content: "list projects" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "c1", type: "function", function: { name: "list_projects", arguments: "{}" } }],
        },
        { role: "tool", tool_name: "list_projects", content: "[]" },
      ],
      model: "llama3.2:1b",
    });
    const assistantMsg = captured.body.messages.find((m) => m.role === "assistant");
    assert.ok(Array.isArray(assistantMsg.tool_calls), "tool_calls forwarded");
    assert.equal(assistantMsg.tool_calls[0].function.name, "list_projects");
    const toolMsg = captured.body.messages.find((m) => m.role === "tool");
    assert.equal(toolMsg.tool_name, "list_projects", "tool_name forwarded");
  } finally {
    restore();
  }
});

// ── Tool-call arguments: object, never a JSON string ────────────────────────
//
// 2026-09-14, in production. An agent left two renders running whose commands
// echoed segment JSON into a file. Both finished, both wake-ups started a turn,
// and both turns died on the second iteration — the one that replays the call —
// with `ollama 400: {"error":"Value looks like object, but can't find closing
// '}' symbol"}`. The agent was woken twice and answered nothing either time.
//
// Ollama wants `arguments` as an OBJECT and parses a string leniently, scanning
// for a closing brace: `{"command":"ls"}` survives, a command carrying its own
// JSON does not. A string arrives here two ordinary ways — a turn that fell back
// from another engine mid-loop, and `extractBareFunctionCalls`, which
// stringifies on purpose — so the adapter normalises at the boundary.

test("ollama: a tool call's string arguments are sent as an object", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  // The shape that actually broke: a shell command with JSON inside it.
  const args = { command: `echo '[{"start": 0, "end": 5, "text": "HOOK"}]' > segments.json`, background: true };
  try {
    await ollama.chat({
      model: "gemma4:31b-cloud",
      messages: [
        { role: "user", content: "lanzalo" },
        { role: "assistant", content: "", tool_calls: [{ function: { name: "run_shell", arguments: JSON.stringify(args) } }] },
        { role: "tool", tool_name: "run_shell", content: '{"ok":true}' },
      ],
    });
  } finally {
    restore();
  }
  const sent = captured.body.messages.find((m) => m.tool_calls)?.tool_calls?.[0];
  assert.equal(typeof sent.function.arguments, "object", "Ollama is given an object, not a string");
  assert.deepEqual(sent.function.arguments, args, "and every argument survives the trip");
});

test("ollama: arguments that are already an object are left alone", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  const args = { command: "ls /tmp" };
  try {
    await ollama.chat({
      model: "m",
      messages: [{ role: "assistant", content: "", tool_calls: [{ id: "c1", function: { name: "run_shell", arguments: args } }] }],
    });
  } finally {
    restore();
  }
  const sent = captured.body.messages[0].tool_calls[0];
  assert.deepEqual(sent.function.arguments, args);
  assert.equal(sent.id, "c1", "and the rest of the call is untouched");
});

test("ollama: arguments that are not valid JSON do not take the turn down", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await ollama.chat({
      model: "m",
      messages: [{ role: "assistant", content: "", tool_calls: [{ function: { name: "run_shell", arguments: "{not json" } }] }],
    });
  } finally {
    restore();
  }
  // Empty, the way the agent loop itself reads an unparseable argument string.
  // The call already ran; losing its arguments is a poorer record than sending
  // them, and losing the whole turn is worse than either.
  assert.deepEqual(captured.body.messages[0].tool_calls[0].function.arguments, {});
});

test("ollama: keeps the model resident for streamed and non-streamed chats", async () => {
  const original = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) {
      return {
        ok: true,
        json: async () => ({ message: { role: "assistant", content: "ok" } }),
      };
    }
    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"ok"},"done":true}\n'));
          controller.close();
        },
      }),
    };
  };
  try {
    await ollama.chat({ model: "m", messages: [{ role: "user", content: "one" }] });
    await ollama.chat({
      model: "m",
      messages: [{ role: "user", content: "two" }],
      onToken: () => {},
    });
  } finally {
    global.fetch = original;
  }
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].keep_alive, -1, "non-streamed chats retain the model");
  assert.equal(bodies[1].keep_alive, -1, "streamed chats retain the model");
});
