// Tests for engines/gemini.js — thought-signature handling on tool turns.
//
// Gemini 3.x thinking models stamp a `thoughtSignature` on the parts of their
// own turn and validate, on the NEXT request, that every functionCall part we
// replay still carries it:
//
//   400 Function call is missing a thought_signature in functionCall parts.
//       … Additional data, function call default_api:create_task, position 24
//
// The signature lives on the PART, and can sit on a sibling text part rather
// than on the functionCall itself — so the model turn has to be echoed back
// verbatim, not rebuilt from our OpenAI-shaped tool_calls. These tests verify:
//   - a Gemini turn is replayed part-for-part, signatures intact
//   - the response parser hands the raw parts back as `_geminiRawParts`
//   - a call with no signature at all (pseudo-tool call, or one inherited from
//     another engine) is narrated as text instead of being sent as a
//     signature-less functionCall — and its tool result degrades with it
//   - Gemini 2.x, which never emits signatures, is left untouched
//
// We stub global.fetch so the tests run without a Gemini API key.

import { test } from "node:test";
import assert from "node:assert/strict";
import gemini, { modelUsesThoughtSignatures, _resetKeyCooldowns } from "#core/engines/gemini.js";

function stubFetchCapturingBody(responseJson) {
  _resetKeyCooldowns();
  const captured = {};
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captured.url = url;
    captured.body = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () =>
        responseJson || {
          candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
        },
    };
  };
  return { captured, restore: () => { global.fetch = original; } };
}

const CONFIG = { api_key: "test-key" };

// An assistant turn exactly as run-agent.js records it after a Gemini 3
// response that put the signature on the leading text part.
function geminiToolTurn() {
  return [
    { role: "user", content: "creá la tarea" },
    {
      role: "assistant",
      content: "Voy a crearla.",
      tool_calls: [
        {
          id: "gemini_abc123",
          type: "function",
          function: { name: "create_task", arguments: '{"title":"comprar pan"}' },
        },
      ],
      _geminiRawParts: [
        { text: "Voy a crearla.", thoughtSignature: "SIG_ON_TEXT_PART" },
        { functionCall: { name: "create_task", args: { title: "comprar pan" } } },
      ],
    },
    {
      role: "tool",
      tool_call_id: "gemini_abc123",
      tool_name: "create_task",
      content: '{"ok":true,"id":7}',
    },
  ];
}

test("gemini: replays the model turn verbatim, keeping thoughtSignature in place", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: geminiToolTurn(),
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const contents = captured.body.contents;
    const modelTurn = contents.find((c) => c.role === "model");
    assert.ok(modelTurn, "model turn must be present");
    // Verbatim: same parts, same order, signature untouched.
    assert.deepEqual(modelTurn.parts, [
      { text: "Voy a crearla.", thoughtSignature: "SIG_ON_TEXT_PART" },
      { functionCall: { name: "create_task", args: { title: "comprar pan" } } },
    ]);
    // The tool result stays a real functionResponse (on a user turn).
    const fnTurn = contents.find((c) => c.parts.some((p) => p.functionResponse));
    assert.equal(fnTurn.role, "user", "gemini 3.6/3.7 reject role 'function'");
    assert.equal(fnTurn.parts[0].functionResponse.name, "create_task");
  } finally {
    restore();
  }
});

test("gemini: response parser returns raw parts as _geminiRawParts", async () => {
  const rawParts = [
    { text: "Dale.", thoughtSignature: "SIG_A" },
    { functionCall: { name: "create_task", args: { title: "x" } }, thoughtSignature: "SIG_B" },
  ];
  const { restore } = stubFetchCapturingBody({
    candidates: [{ content: { parts: rawParts }, finishReason: "STOP" }],
    usageMetadata: {},
  });
  try {
    const res = await gemini.chat({
      messages: [{ role: "user", content: "hola" }],
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    assert.deepEqual(res._geminiRawParts, rawParts, "raw parts survive untouched");
    assert.equal(res.tool_calls[0]._thoughtSignature, "SIG_B", "per-call fallback copy kept");
  } finally {
    restore();
  }
});

test("gemini: _geminiRawParts round-trip does not lose the signature", async () => {
  const rawParts = [
    { text: "Voy.", thoughtSignature: "SIG_ROUNDTRIP" },
    { functionCall: { name: "create_task", args: { title: "x" } } },
  ];
  const first = stubFetchCapturingBody({
    candidates: [{ content: { parts: rawParts }, finishReason: "STOP" }],
    usageMetadata: {},
  });
  let res;
  try {
    res = await gemini.chat({
      messages: [{ role: "user", content: "hola" }],
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
  } finally {
    first.restore();
  }

  // Second hop: exactly what run-agent pushes onto the conversation.
  const second = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "hola" },
        {
          role: "assistant",
          content: res.text,
          tool_calls: res.tool_calls,
          _geminiRawParts: res._geminiRawParts,
        },
        { role: "tool", tool_call_id: res.tool_calls[0].id, tool_name: "create_task", content: "{}" },
      ],
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const modelTurn = second.captured.body.contents.find((c) => c.role === "model");
    assert.ok(
      modelTurn.parts.some((p) => p.thoughtSignature === "SIG_ROUNDTRIP"),
      "signature replayed on the next request"
    );
    assert.ok(modelTurn.parts.some((p) => p.functionCall), "the call itself is still a functionCall");
  } finally {
    second.restore();
  }
});

test("gemini 3: a call with no signature is dropped, never sent bare nor transcribed", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá la tarea" },
        {
          role: "assistant",
          content: "",
          // Pseudo-parsed / foreign-engine call: no _geminiRawParts, no signature.
          tool_calls: [
            { id: "pseudo_1", type: "function", function: { name: "create_task", arguments: '{"title":"x"}' } },
          ],
        },
        { role: "tool", tool_call_id: "pseudo_1", tool_name: "create_task", content: '{"ok":true}' },
      ],
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const contents = captured.body.contents;
    const allParts = contents.flatMap((c) => c.parts);
    // The 400 trigger — a functionCall part with no thought_signature — is gone.
    for (const p of allParts) {
      if (p.functionCall) {
        assert.ok(p.thoughtSignature, "no signature-less functionCall may be sent to gemini 3");
      }
    }
    // And it is NOT transcribed into text either: a model turn that reads like
    // a written-out call is a worked example the model copies, which is how
    // "[tool call: run_shell] {…}" ended up being delivered to a user.
    const everyText = allParts.map((p) => p.text || "").join("\n");
    assert.ok(!/\[tool call:/i.test(everyText), `call transcribed into history: ${everyText}`);
    // Its result degrades too — a functionResponse with no matching call is invalid.
    assert.equal(contents.find((c) => c.parts.some((p) => p.functionResponse)), undefined);
    // …but the result itself still reaches the model, as a plain observation.
    assert.match(everyText, /Resultado de create_task/);
  } finally {
    restore();
  }
});

test("gemini: a model outside the signature list keeps its bare calls", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá la tarea" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "g_1", type: "function", function: { name: "create_task", arguments: '{"title":"x"}' } },
          ],
        },
        { role: "tool", tool_call_id: "g_1", tool_name: "create_task", content: '{"ok":true}' },
      ],
      // Not matched by THOUGHT_SIGNATURE_MODELS, and nothing in this history
      // ever carried a signature — so there is no rule to enforce.
      model: "gemini-2.0-flash",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const contents = captured.body.contents;
    const modelTurn = contents.find((c) => c.role === "model");
    assert.equal(modelTurn.parts[0].functionCall.name, "create_task", "still a real functionCall");
    assert.ok(
      contents.find((c) => c.parts.some((p) => p.functionResponse)),
      "tool result stays a functionResponse"
    );
  } finally {
    restore();
  }
});

test("gemini: a per-call signature is replayed when there are no _geminiRawParts", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá la tarea" },
        {
          role: "assistant",
          content: "Listo",
          tool_calls: [
            {
              id: "g_1",
              type: "function",
              function: { name: "create_task", arguments: '{"title":"x"}' },
              _thoughtSignature: "SIG_ON_CALL",
            },
          ],
        },
        { role: "tool", tool_call_id: "g_1", tool_name: "create_task", content: "{}" },
      ],
      model: "gemini-3-pro-preview",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const modelTurn = captured.body.contents.find((c) => c.role === "model");
    const callPart = modelTurn.parts.find((p) => p.functionCall);
    assert.equal(callPart.thoughtSignature, "SIG_ON_CALL");
    assert.equal(modelTurn.parts[0].text, "Listo", "assistant text is no longer dropped");
  } finally {
    restore();
  }
});

test("gemini: parallel calls keep the single leading signature and merge their results", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá tres tareas" },
        {
          role: "assistant",
          content: "",
          // Gemini stamps only the FIRST functionCall part of a parallel turn;
          // the siblings come back bare and the API accepts them that way.
          tool_calls: [
            { id: "g_1", type: "function", function: { name: "create_task", arguments: '{"title":"a"}' }, _thoughtSignature: "SIG_FIRST" },
            { id: "g_2", type: "function", function: { name: "create_task", arguments: '{"title":"b"}' } },
            { id: "g_3", type: "function", function: { name: "create_task", arguments: '{"title":"c"}' } },
          ],
        },
        { role: "tool", tool_call_id: "g_1", tool_name: "create_task", content: "{}" },
        { role: "tool", tool_call_id: "g_2", tool_name: "create_task", content: "{}" },
        { role: "tool", tool_call_id: "g_3", tool_name: "create_task", content: "{}" },
      ],
      model: "gemini-3.5-flash",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const contents = captured.body.contents;
    const modelTurn = contents.find((c) => c.role === "model");
    const calls = modelTurn.parts.filter((p) => p.functionCall);
    assert.equal(calls.length, 3, "all three stay real calls — none degraded");
    assert.equal(calls[0].thoughtSignature, "SIG_FIRST");
    assert.equal(calls[1].thoughtSignature, undefined, "siblings stay bare, as the model sent them");
    // The three results belong to one turn, mirroring the single model turn.
    const resultTurns = contents.filter((c) => c.parts.some((p) => p.functionResponse));
    assert.equal(resultTurns.length, 1);
    assert.equal(resultTurns[0].parts.length, 3);
  } finally {
    restore();
  }
});

test("gemini: tool results never use role 'function' (rejected by 3.6/3.7)", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: geminiToolTurn(),
      model: "gemini-3.7-flash",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const roles = captured.body.contents.map((c) => c.role);
    assert.ok(!roles.includes("function"), `no 'function' role may be sent, got ${roles.join(",")}`);
    assert.deepEqual([...new Set(roles)].sort(), ["model", "user"]);
  } finally {
    restore();
  }
});

// ── Which models the rule applies to ────────────────────────────────────────
// The gate is a declarative glob list, not a version check buried in the code.

test("THOUGHT_SIGNATURE_MODELS covers every family observed to sign", () => {
  for (const id of [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3-pro-preview",
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-3.7-flash",
    "gemini-4-flash",   // forward default: covered the day it ships
    "gemini-5-pro",
  ]) {
    assert.ok(modelUsesThoughtSignatures(id), `${id} must be covered`);
  }
  for (const id of ["gemini-2.0-flash", "gemini-1.5-pro", ""]) {
    assert.equal(modelUsesThoughtSignatures(id), false, `${id} must not be covered`);
  }
});

test("the model list is overridable from config, no code change", async () => {
  // An install that declares its own list replaces the default outright.
  assert.equal(
    modelUsesThoughtSignatures("my-tuned-gemini-x", { thought_signature_models: ["my-tuned-*"] }),
    true
  );
  assert.equal(
    modelUsesThoughtSignatures("gemini-3.5-flash", { thought_signature_models: ["my-tuned-*"] }),
    false,
    "a configured list is the whole answer, not an addition"
  );
  assert.equal(
    modelUsesThoughtSignatures("gemini-3.5-flash", { thought_signature_models: [] }),
    false,
    "an explicit empty list opts out"
  );

  // And it reaches the wire: opted out, a signature-less call is sent as-is.
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá la tarea" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "g_1", type: "function", function: { name: "create_task", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "g_1", tool_name: "create_task", content: "{}" },
      ],
      model: "gemini-3.5-flash",
      config: { ...CONFIG, thought_signature_models: [] },
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const modelTurn = captured.body.contents.find((c) => c.role === "model");
    assert.ok(modelTurn.parts[0].functionCall, "opted out — no degrading");
  } finally {
    restore();
  }
});

test("an undeclared model that signed earlier is treated as signing", async () => {
  const { captured, restore } = stubFetchCapturingBody();
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "creá la tarea" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            { id: "a_1", type: "function", function: { name: "create_task", arguments: "{}" }, _thoughtSignature: "SIG" },
          ],
        },
        { role: "tool", tool_call_id: "a_1", tool_name: "create_task", content: "{}" },
        { role: "user", content: "otra más" },
        {
          role: "assistant",
          content: "",
          // Same conversation, but this turn never got a signature.
          tool_calls: [
            { id: "a_2", type: "function", function: { name: "create_task", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "a_2", tool_name: "create_task", content: "{}" },
      ],
      // Nothing in the glob list matches — the evidence in the history decides.
      model: "some-unlisted-model",
      config: CONFIG,
      tools: [{ type: "function", function: { name: "create_task", parameters: {} } }],
    });
    const calls = captured.body.contents.flatMap((c) => c.parts).filter((p) => p.functionCall);
    assert.equal(calls.length, 1, "the unsigned turn was degraded, the signed one kept");
    assert.equal(calls[0].thoughtSignature, "SIG");
  } finally {
    restore();
  }
});
