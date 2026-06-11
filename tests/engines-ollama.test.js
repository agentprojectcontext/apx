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
