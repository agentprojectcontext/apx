import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleEngine } from "#core/engines/openai-compatible.js";

test("openai-compatible: uses config.base_url override", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test",
    defaultBaseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "TEST_OPENAI_KEY",
  });

  let calledUrl = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    process.env.TEST_OPENAI_KEY = "test-key";
    await engine.chat({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "ping" }],
      config: { api_key: "test-key", base_url: "https://api.groq.com/openai/v1" },
    });
    assert.equal(calledUrl, "https://api.groq.com/openai/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_OPENAI_KEY;
  }
});

// Zen's free tier answers 429 unless the caller names itself as the opencode
// client, so the User-Agent is load-bearing, not decoration. These two pin it:
// that the engine's default header reaches the wire, and that config can move
// the version when the gateway asks for a newer one.
test("zen: sends the opencode User-Agent on chat", async () => {
  const { default: zen } = await import("#core/engines/zen.js");

  let sent = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    sent = opts.headers;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "ping" }],
      config: { api_key: "zen-key" },
    });
    assert.equal(sent["user-agent"], "opencode/1.18.18");
    assert.equal(sent.authorization, "Bearer zen-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible: config.headers override the engine's, never the key", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test",
    defaultBaseUrl: "https://example.test/v1",
    apiKeyEnv: "TEST_HEADERS_KEY",
    extraHeaders: { "user-agent": "engine/1.0" },
  });

  let sent = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    sent = opts.headers;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    };
  };

  try {
    await engine.chat({
      model: "m",
      messages: [{ role: "user", content: "ping" }],
      config: {
        api_key: "real-key",
        headers: { "User-Agent": "opencode/9.9.9", authorization: "Bearer stolen" },
      },
    });
    assert.equal(sent["user-agent"], "opencode/9.9.9");
    assert.equal(sent.authorization, "Bearer real-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// --- reasoning + streaming -------------------------------------------------
// A reasoning model answers in two channels at once: `content` is the reply,
// `reasoning_content` is it thinking out loud. They must never be spliced into
// one string — that is how <think> ended up rendered in a chat bubble.

function sseResponse(rows) {
  return {
    ok: true,
    body: (async function* () {
      const enc = new TextEncoder();
      for (const r of rows) yield enc.encode(`data: ${JSON.stringify(r)}\n\n`);
      yield enc.encode("data: [DONE]\n\n");
    })(),
  };
}

test("openai-compatible: reasoning comes back beside the answer, not inside it", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test", defaultBaseUrl: "https://example.test/v1", apiKeyEnv: "TEST_R_KEY",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "Hola", reasoning_content: "El usuario saluda" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    }),
  });
  try {
    const r = await engine.chat({
      model: "m", messages: [{ role: "user", content: "hola" }], config: { api_key: "k" },
    });
    assert.equal(r.text, "Hola");
    assert.equal(r.reasoning, "El usuario saluda");
    assert.ok(!r.text.includes("<think>"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible: streams content to onToken, keeps reasoning off the wire", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test", defaultBaseUrl: "https://example.test/v1", apiKeyEnv: "TEST_S_KEY",
  });
  const tokens = [];
  let sentBody = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    sentBody = JSON.parse(opts.body);
    return sseResponse([
      { choices: [{ delta: { reasoning_content: "pensando…" } }] },
      { choices: [{ delta: { content: "Ho" } }] },
      { choices: [{ delta: { content: "la" } }, ] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { choices: [], usage: { prompt_tokens: 7, completion_tokens: 2 } },
    ]);
  };
  try {
    const r = await engine.chat({
      model: "m",
      messages: [{ role: "user", content: "hola" }],
      config: { api_key: "k" },
      onToken: (t2) => tokens.push(t2),
    });
    assert.equal(sentBody.stream, true);
    assert.deepEqual(tokens, ["Ho", "la"]);
    assert.equal(r.text, "Hola");
    assert.equal(r.reasoning, "pensando…");
    assert.equal(r.finish_reason, "stop");
    assert.deepEqual(r.usage, { input_tokens: 7, output_tokens: 2 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible: a streamed tool call is reassembled from its deltas", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test", defaultBaseUrl: "https://example.test/v1", apiKeyEnv: "TEST_T_KEY",
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "list_", arguments: "" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "tasks", arguments: '{"pro' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ject":1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ]);
  try {
    const r = await engine.chat({
      model: "m", messages: [{ role: "user", content: "tareas" }],
      config: { api_key: "k" }, tools: [{ type: "function", function: { name: "list_tasks" } }],
      onToken: () => {},
    });
    assert.equal(r.tool_calls.length, 1);
    assert.equal(r.tool_calls[0].id, "call_1");
    assert.equal(r.tool_calls[0].function.name, "list_tasks");
    assert.deepEqual(JSON.parse(r.tool_calls[0].function.arguments), { project: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible: thinking:false asks the provider to skip reasoning", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test", defaultBaseUrl: "https://example.test/v1", apiKeyEnv: "TEST_TH_KEY",
  });
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }], usage: {} }),
    };
  };
  try {
    const call = (config) =>
      engine.chat({ model: "m", messages: [{ role: "user", content: "x" }], config });
    await call({ api_key: "k" });
    await call({ api_key: "k", thinking: false });
    // Unset means "provider's own default" — the field is never sent uninvited,
    // because a provider that doesn't know it answers 400.
    assert.equal("reasoning_effort" in bodies[0], false);
    assert.equal(bodies[1].reasoning_effort, "none");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("openai-compatible: reasoning streams on its own callback, never onToken", async () => {
  const engine = createOpenAiCompatibleEngine({
    id: "test", defaultBaseUrl: "https://example.test/v1", apiKeyEnv: "TEST_RS_KEY",
  });
  const answer = [];
  const thinking = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    sseResponse([
      { choices: [{ delta: { reasoning_content: "primero " } }] },
      { choices: [{ delta: { reasoning_content: "pienso" } }] },
      { choices: [{ delta: { content: "Hola" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ]);
  try {
    const r = await engine.chat({
      model: "m",
      messages: [{ role: "user", content: "hola" }],
      config: { api_key: "k" },
      onToken: (x) => answer.push(x),
      onReasoningToken: (x) => thinking.push(x),
    });
    // The desktop pipes onToken straight to TTS — a word of reasoning in there
    // is a word the user hears out loud.
    assert.deepEqual(answer, ["Hola"]);
    assert.deepEqual(thinking, ["primero ", "pienso"]);
    assert.equal(r.text, "Hola");
    assert.equal(r.reasoning, "primero pienso");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
