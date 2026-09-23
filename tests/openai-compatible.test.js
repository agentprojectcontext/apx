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

// Zen's free tier is not keyed, it is GATED: the gateway serves the zero-cost
// models only to a request shaped like the one its own client sends. As of
// 2026-09-18 that is the opencode User-Agent, a non-empty x-opencode-session,
// `stream: true`, and tools named `bash` and `read` — drop any one and it is
// 403. The tests below pin each piece, because the gate has moved three times
// already and every move broke every agent pointed at a zen model at once.

/** APX's real tools. The engine is what renames them on the wire. */
const ZEN_TOOLS = ["run_shell", "read_file"].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: {} } },
}));

/**
 * A stub answer that satisfies BOTH read paths — `.json()` for a blocking
 * call and `.body` for a streamed one — so a test does not have to know which
 * one the engine picked for the model it named.
 */
function zenResponse(content = "hi", rows = null) {
  const deltas = rows || [{ choices: [{ delta: { content }, finish_reason: "stop" }] }];
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    body: (async function* () {
      const enc = new TextEncoder();
      for (const r of deltas) yield enc.encode(`data: ${JSON.stringify(r)}\n\n`);
      yield enc.encode("data: [DONE]\n\n");
    })(),
  };
}
test("zen: sends the opencode User-Agent on chat", async () => {
  const { default: zen, ZEN_USER_AGENT } = await import("#core/engines/zen.js");

  let sent = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    sent = opts.headers;
    return zenResponse();
  };

  try {
    await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "ping" }],
      tools: ZEN_TOOLS,
      config: { api_key: "zen-key" },
    });
    assert.equal(sent["user-agent"], ZEN_USER_AGENT);
    assert.equal(sent.authorization, "Bearer zen-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zen: falls back to api_key public when none is configured", async () => {
  const { default: zen, ZEN_PUBLIC_API_KEY, ZEN_USER_AGENT } = await import(
    "#core/engines/zen.js"
  );

  let sent = {};
  const originalFetch = globalThis.fetch;
  const prev = process.env.OPENCODE_ZEN_API_KEY;
  delete process.env.OPENCODE_ZEN_API_KEY;
  globalThis.fetch = async (_url, opts) => {
    sent = opts.headers;
    return zenResponse();
  };

  try {
    await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "ping" }],
      tools: ZEN_TOOLS,
      config: {},
    });
    assert.equal(sent["user-agent"], ZEN_USER_AGENT);
    assert.equal(sent.authorization, `Bearer ${ZEN_PUBLIC_API_KEY}`);
  } finally {
    globalThis.fetch = originalFetch;
    if (prev === undefined) delete process.env.OPENCODE_ZEN_API_KEY;
    else process.env.OPENCODE_ZEN_API_KEY = prev;
  }
});

// The 2026-09-07 break: the gateway answers 400 MissingSessionID when
// x-opencode-session is absent OR empty, so what matters is that a non-empty
// id reaches the wire, and that it is the same id on the next call — the
// gateway pins a session to one upstream provider.
test("zen: sends a stable, non-empty x-opencode-session on every chat", async () => {
  const { default: zen, ZEN_SESSION_ID } = await import("#core/engines/zen.js");

  const seen = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    seen.push(opts.headers);
    return zenResponse();
  };

  try {
    for (let i = 0; i < 2; i++) {
      await zen.chat({
        model: "big-pickle",
        messages: [{ role: "user", content: "ping" }],
        tools: ZEN_TOOLS,
        config: { api_key: "zen-key" },
      });
    }
    assert.match(ZEN_SESSION_ID, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    assert.equal(seen[0]["x-opencode-session"], ZEN_SESSION_ID);
    assert.equal(seen[1]["x-opencode-session"], ZEN_SESSION_ID);
    // The request id travels too, and is per call, not per process.
    assert.match(seen[0]["x-opencode-request"], /^msg_/);
    assert.notEqual(seen[0]["x-opencode-request"], seen[1]["x-opencode-request"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// The other two halves of the gate, which live in the BODY rather than the
// headers, and the translation that lets APX satisfy them without inventing a
// tool it does not have.
test("zen: a free model goes out as bash+read and comes back under APX's names", async () => {
  const { default: zen } = await import("#core/engines/zen.js");

  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    // The model answers with the gateway's name for the tool…
    return zenResponse("", [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "c1", type: "function", function: { name: "bash", arguments: '{"cmd":"date"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
  };

  try {
    const r = await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "corré date" }],
      tools: [...ZEN_TOOLS, { type: "function", function: { name: "send_telegram" } }],
      config: { api_key: "zen-key" },
    });

    // Out: the two the gate looks for, renamed; everything else untouched.
    const names = body.tools.map((t) => t.function.name);
    assert.deepEqual(names, ["bash", "read", "send_telegram"]);
    // …and back in under the name the loop actually dispatches on.
    assert.equal(r.tool_calls[0].function.name, "run_shell");
    assert.equal(r.tool_calls[0].id, "c1");
    assert.deepEqual(JSON.parse(r.tool_calls[0].function.arguments), { cmd: "date" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zen: a free model is streamed even when no caller asked for tokens", async () => {
  const { default: zen } = await import("#core/engines/zen.js");

  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return zenResponse("listo");
  };

  try {
    // No onToken anywhere: this is the shape every non-streaming surface sends,
    // and a blocking request is exactly what the gateway 403s.
    const free = await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "ping" }],
      tools: ZEN_TOOLS,
      config: { api_key: "zen-key" },
    });
    assert.equal(bodies[0].stream, true, "the free tier only answers a stream");
    assert.equal(free.text, "listo", "and the caller still gets a plain result");

    // A paid model on the same gateway is left alone — nothing is forced.
    await zen.chat({
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "ping" }],
      config: { api_key: "zen-key" },
    });
    assert.equal(bodies[1].stream, undefined, "a paid model keeps the blocking path");
    assert.equal("tools" in bodies[1], false, "and is not handed tools it was not given");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zen: a narrow agent is served too — the gate's tools go out as placeholders that run nothing", async () => {
  const { default: zen } = await import("#core/engines/zen.js");

  // april, the secretary crons, a company exec: a short, deliberate tool list
  // with no shell. They used to be refused here and skipped the router's #1.
  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    // The model calls a placeholder anyway, and the agent's real tool.
    return zenResponse("", [{
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, id: "c1", type: "function", function: { name: "bash", arguments: "{}" } },
            { index: 1, id: "c2", type: "function", function: { name: "send_telegram", arguments: "{}" } },
          ],
        },
        finish_reason: "tool_calls",
      }],
    }]);
  };
  try {
    const r = await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "hola" }],
      tools: [{ type: "function", function: { name: "send_telegram" } }],
      config: { api_key: "zen-key" },
    });
    assert.deepEqual(body.tools.map((t) => t.function.name), ["send_telegram", "bash", "read"]);
    assert.notEqual(body.tool_choice, "none", "its real tools stay callable");
    // A placeholder is NEVER mapped back to run_shell: under its wire name no
    // handler answers it, and the loop refuses it as an unknown tool.
    assert.deepEqual(r.tool_calls.map((c) => c.function.name), ["bash", "send_telegram"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zen: an agent with only one of the two gets the other as a placeholder", async () => {
  const { default: zen } = await import("#core/engines/zen.js");
  let body = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    body = JSON.parse(opts.body);
    return zenResponse("", [{
      choices: [{
        delta: { tool_calls: [
          { index: 0, id: "c1", type: "function", function: { name: "read", arguments: "{}" } },
          { index: 1, id: "c2", type: "function", function: { name: "bash", arguments: "{}" } },
        ] },
        finish_reason: "tool_calls",
      }],
    }]);
  };
  try {
    const r = await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "hola" }],
      tools: [{ type: "function", function: { name: "read_file" } }],
      config: { api_key: "zen-key" },
    });
    assert.deepEqual(body.tools.map((t) => t.function.name), ["read", "bash"]);
    // The real one comes back under APX's name; the placeholder does not.
    assert.deepEqual(r.tool_calls.map((c) => c.function.name), ["read_file", "bash"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("retry: an adapter's own verdict beats the message heuristic", async () => {
  const { isRetryableEngineError } = await import("#core/agent/retry.js");

  // Prose no classifier would ever guess right, in either direction.
  const rotate = new Error("some provider said something only it understands");
  rotate.retryable = true;
  assert.equal(isRetryableEngineError(rotate), true);

  // And an adapter can pin a fatal that the phrases would have rotated on.
  const stop = new Error("rate limit");
  assert.equal(isRetryableEngineError(stop), true, "the phrase alone rotates");
  stop.retryable = false;
  assert.equal(isRetryableEngineError(stop), false, "the adapter overrides it");
});

test("zen: engines.zen.session_per_call mints a new session id every time", async () => {
  const { zenHeaders, ZEN_SESSION_ID } = await import("#core/engines/zen.js");

  // The default pins one session per process: the gateway pins a session to an
  // upstream provider, so a fresh id per call scatters one conversation's turns
  // across providers and loses the prompt cache.
  assert.equal(zenHeaders()["x-opencode-session"], ZEN_SESSION_ID);
  assert.equal(zenHeaders({})["x-opencode-session"], ZEN_SESSION_ID);

  // Opt in and every call carries its own — also accepted by the gateway.
  const a = zenHeaders({ session_per_call: true })["x-opencode-session"];
  const b = zenHeaders({ session_per_call: true })["x-opencode-session"];
  assert.match(a, /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  assert.notEqual(a, b);
  assert.notEqual(a, ZEN_SESSION_ID);
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

// --- per-model wire quirks (Zen / DeepSeek) --------------------------------
// DeepSeek's thinking mode counts `reasoning_content` as part of the assistant
// turn: replay the turn without it and the gateway answers 400. The older
// reasoners reject the same field, so this has to stay scoped by model.

function captureZenBody() {
  const originalFetch = globalThis.fetch;
  const state = { body: null, restore: () => { globalThis.fetch = originalFetch; } };
  globalThis.fetch = async (_url, opts) => {
    state.body = JSON.parse(opts.body);
    return zenResponse("ok");
  };
  return state;
}

const THINKING_HISTORY = [
  { role: "user", content: "listá las rutinas" },
  {
    role: "assistant",
    content: "",
    _reasoning: "El usuario quiere las rutinas; leo el directorio.",
    tool_calls: [{ id: "c1", type: "function", function: { name: "run_shell", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "c1", tool_name: "run_shell", content: "cron-ideas" },
];

test("zen: replays reasoning_content for the models whose thinking mode demands it", async () => {
  const { default: zen } = await import("#core/engines/zen.js");
  const cap = captureZenBody();
  try {
    await zen.chat({
      model: "deepseek-v4-flash-free",
      messages: THINKING_HISTORY,
      tools: ZEN_TOOLS,
      config: { api_key: "zen-key" },
    });
    const assistant = cap.body.messages.find((m) => m.role === "assistant");
    assert.equal(assistant.reasoning_content, "El usuario quiere las rutinas; leo el directorio.");
    // The private field itself never reaches the wire.
    assert.equal("_reasoning" in assistant, false);
  } finally {
    cap.restore();
  }
});

test("zen: other models never see reasoning_content (deepseek-r1 et al reject it)", async () => {
  const { default: zen } = await import("#core/engines/zen.js");
  const cap = captureZenBody();
  try {
    await zen.chat({
      model: "big-pickle",
      messages: THINKING_HISTORY,
      tools: ZEN_TOOLS,
      config: { api_key: "zen-key" },
    });
    const assistant = cap.body.messages.find((m) => m.role === "assistant");
    assert.equal("reasoning_content" in assistant, false);
  } finally {
    cap.restore();
  }
});

test("zen: engines.zen.reasoning_replay_models replaces the built-in list", async () => {
  const { default: zen, modelReplaysReasoning } = await import("#core/engines/zen.js");
  assert.equal(modelReplaysReasoning("deepseek-v4-flash-free"), true);
  assert.equal(modelReplaysReasoning("deepseek-r1"), false);
  // An explicit list is the whole answer — including an empty one, which opts
  // the install out entirely.
  assert.equal(
    modelReplaysReasoning("deepseek-v4-flash-free", { reasoning_replay_models: [] }),
    false,
  );

  const cap = captureZenBody();
  try {
    await zen.chat({
      model: "some-new-reasoner",
      messages: THINKING_HISTORY,
      config: { api_key: "zen-key", reasoning_replay_models: ["some-new-*"] },
    });
    const assistant = cap.body.messages.find((m) => m.role === "assistant");
    assert.equal(assistant.reasoning_content, "El usuario quiere las rutinas; leo el directorio.");
  } finally {
    cap.restore();
  }
});

test("zen: a turn with no stored reasoning is sent as-is, not invented", async () => {
  const { default: zen } = await import("#core/engines/zen.js");
  const cap = captureZenBody();
  try {
    await zen.chat({
      model: "deepseek-v4-flash-free",
      messages: [
        { role: "user", content: "hola" },
        { role: "assistant", content: "Hola" },
      ],
      tools: ZEN_TOOLS,
      config: { api_key: "zen-key" },
    });
    const assistant = cap.body.messages.find((m) => m.role === "assistant");
    assert.equal("reasoning_content" in assistant, false);
  } finally {
    cap.restore();
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

// A turn with NO tools at all — a sealed WhatsApp reply, a summary. It used to
// be refused like a narrow agent, so every contact's reply skipped the router's
// #1 and fell to whatever was left (2026-09-23: a local 8B model, 157 s).
test("zen: a tool-free call meets the gate with declarations it cannot call", async () => {
  const { default: zen } = await import("#core/engines/zen.js");

  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return zenResponse("hola!"); };
  try {
    const r = await zen.chat({
      model: "big-pickle",
      messages: [{ role: "user", content: "hola" }],
      config: { api_key: "zen-key" },
    });
    assert.equal(r.text, "hola!");
    assert.deepEqual(bodies[0].tools.map((t) => t.function.name), ["bash", "read"]);
    assert.equal(bodies[0].tool_choice, "none", "declared, never callable");
    assert.equal(bodies[0].stream, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("zen: a tool call on a tool-free call is dropped, or rotated past when it is all there is", async () => {
  const { default: zen } = await import("#core/engines/zen.js");
  const { isRetryableEngineError } = await import("#core/agent/retry.js");
  const call = { index: 0, id: "c1", type: "function", function: { name: "bash", arguments: "{}" } };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => zenResponse("", [
      { choices: [{ delta: { content: "te cuento" } }] },
      { choices: [{ delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] },
    ]);
    const r = await zen.chat({ model: "big-pickle", messages: [{ role: "user", content: "hola" }], config: { api_key: "k" } });
    assert.equal(r.text, "te cuento");
    assert.equal(r.tool_calls.length, 0, "nothing to dispatch it to");

    globalThis.fetch = async () => zenResponse("", [
      { choices: [{ delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] },
    ]);
    const err = await zen.chat({ model: "big-pickle", messages: [{ role: "user", content: "hola" }], config: { api_key: "k" } })
      .catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(isRetryableEngineError(err), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
