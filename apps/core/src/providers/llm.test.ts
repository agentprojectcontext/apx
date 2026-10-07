import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProviderConfig } from "../config.ts";
import { createSecrets } from "../secrets.ts";
import { toAnthropic } from "./anthropic-messages.ts";
import { createLlm } from "./llm.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-llm-"));
const secrets = createSecrets(home, "file", {});
secrets.set("a", "key-a");
secrets.set("b", "key-b");

const providers: ProviderConfig[] = [
  { id: "pa", transport: "openai-chat", base_url: "http://a.test", key: "secret://a", models: ["m1", "m2"] },
  { id: "pb", transport: "openai-chat", base_url: "http://b.test", key: "secret://b", models: ["m3"] },
  { id: "pc", transport: "openai-chat", base_url: "http://c.test", key: "secret://missing", models: ["m4"] },
];

function sse(lines: object[]): Response {
  const body = `${lines.map((l) => `data: ${JSON.stringify(l)}`).join("\n")}\ndata: [DONE]`; // no trailing newline
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("falls back down the chain on overload and reports which model answered", async () => {
  const seen: string[] = [];
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async (url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      seen.push(`${new URL(url).host}/${model}`);
      if (model === "m1") return new Response("overloaded", { status: 503 });
      return sse([
        { choices: [{ delta: { content: "ho" } }] },
        {
          choices: [{ delta: { content: "la" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        },
      ]);
    }) as typeof fetch,
  });
  let streamed = "";
  const out = await llm.complete({
    models: ["pa"],
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    signal: new AbortController().signal,
    onText: (t) => {
      streamed = t;
    },
  });
  assert.equal(out.model, "pa/m2");
  assert.equal(out.message.content, "hola");
  assert.equal(streamed, "hola");
  assert.equal(out.finish, "stop");
  assert.deepEqual(out.usage, { input: 3, output: 2 });
  assert.deepEqual(seen, ["a.test/m1", "a.test/m1", "a.test/m2"]);
});

test("models are tried in the given order; quota moves on; providers without a key are never called", async () => {
  const seen: string[] = [];
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async (url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      seen.push(model);
      if (new URL(url).host === "b.test") return new Response("You exceeded your current quota", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "length" }] }));
    }) as typeof fetch,
  });
  const out = await llm.complete({
    models: ["pb/m3", "pa", "pc"],
    messages: [],
    tools: [],
    signal: new AbortController().signal,
  });
  assert.deepEqual(seen, ["m3", "m1"]);
  assert.equal(out.model, "pa/m1");
  assert.equal(out.finish, "length");
  assert.equal(llm.label(), "pa, pb");
});

test("tool calls stream in fragments and keep provider extras", async () => {
  const llm = createLlm({
    providers: () => providers.slice(0, 1),
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async () =>
      sse([
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: '{"a"' } }] } }] },
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "tool_calls" },
          ],
        },
      ])) as unknown as typeof fetch,
  });
  const out = await llm.complete({
    models: ["pa"],
    messages: [],
    tools: [],
    signal: new AbortController().signal,
    onText: () => {},
  });
  assert.equal(out.message.tool_calls?.[0]?.function.arguments, '{"a":1}');
  assert.equal(out.finish, "tool_calls");
});

test("anthropic conversion: leading system, later notes as user text, tool calls and results as blocks", () => {
  const { system, messages } = toAnthropic([
    { role: "system", content: "S" },
    { role: "user", content: "u1" },
    {
      role: "assistant",
      content: "thinking",
      tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: '{"x":1}' } }],
    },
    { role: "tool", tool_call_id: "t1", content: "r1" },
    { role: "system", content: "note" },
  ]);
  assert.equal(system, "S");
  assert.deepEqual(messages, [
    { role: "user", content: [{ type: "text", text: "u1" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "thinking" },
        { type: "tool_use", id: "t1", name: "f", input: { x: 1 } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "t1", content: "r1" },
        { type: "text", text: "<system_note>\nnote\n</system_note>" },
      ],
    },
  ]);
});

test("anthropic: the system prompt and the conversation's last block are marked for its cache; cached tokens count in input", async () => {
  secrets.set("c", "key-c");
  let body: { system?: unknown; messages: Array<{ content: Array<Record<string, unknown>> }> } | undefined;
  const llm = createLlm({
    providers: () => [
      { id: "an", transport: "anthropic-messages", base_url: "http://an.test", key: "secret://c", models: ["m"] },
    ],
    secrets,
    firstByteMs: 1000,
    fetchImpl: (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sse([
        {
          type: "message_start",
          message: { usage: { input_tokens: 10, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200 } },
        },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      ]);
    }) as typeof fetch,
  });
  const out = await llm.complete({
    models: ["an/m"],
    messages: [
      { role: "system", content: "You are Roby." },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "and now?" },
    ],
    tools: [],
    signal: new AbortController().signal,
  });
  assert.deepEqual(body?.system, [{ type: "text", text: "You are Roby.", cache_control: { type: "ephemeral" } }]);
  const blocks = body?.messages.flatMap((m) => m.content) ?? [];
  assert.deepEqual(blocks.at(-1), { type: "text", text: "and now?", cache_control: { type: "ephemeral" } });
  assert.equal(blocks.filter((b) => b.cache_control).length, 1, "only the last block of the conversation");
  assert.deepEqual(out.usage, { input: 3210, output: 2, cached: 3000 });
});

test("a per-model quota (Gemini's 429) moves on to the same provider's next model", async () => {
  const seen: string[] = [];
  const llm = createLlm({
    providers: () => providers.slice(0, 1),
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async (_url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      seen.push(model);
      if (model === "m1") return new Response("You exceeded your current quota", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    }) as typeof fetch,
  });
  const out = await llm.complete({ models: ["pa"], messages: [], tools: [], signal: new AbortController().signal });
  assert.deepEqual(seen, ["m1", "m2"]);
  assert.equal(out.model, "pa/m2");
});

test("images: references in the log, bytes only in the call; OpenAI as image_url parts, Anthropic as image blocks", async () => {
  let body: { messages: Array<{ role: string; content: unknown }> } | undefined;
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    media: (id) => (id === "med_1" ? { mime: "image/png", data: "AAAA" } : undefined),
    fetchImpl: (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "a cat" }, finish_reason: "stop" }] }));
    }) as typeof fetch,
  });
  const messages = [
    {
      role: "user" as const,
      content: "what is this?",
      images: [
        { media_id: "med_1", mime: "image/png" },
        { media_id: "gone", mime: "image/png" },
      ],
    },
  ];
  await llm.complete({ models: ["pa"], messages, tools: [], signal: new AbortController().signal });
  assert.deepEqual(body?.messages[0]?.content, [
    { type: "text", text: "what is this?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ]);
  assert.equal(messages[0]?.images[0] && "data" in messages[0].images[0], false, "the log's item is not changed");
  const a = toAnthropic([
    { role: "user", content: "see", images: [{ media_id: "x", mime: "image/png", data: "BBBB" }] },
  ]);
  assert.deepEqual(a.messages[0]?.content[1], {
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "BBBB" },
  });
});

test("a call carries the newest 4 images of the chat; older ones stay references", async () => {
  let body: { messages: Array<{ role: string; content: unknown }> } | undefined;
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    media: (id) => ({ mime: "image/png", data: id }),
    fetchImpl: (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    }) as typeof fetch,
  });
  const img = (id: string) => ({ media_id: id, mime: "image/png" });
  const messages = [
    { role: "user" as const, content: "first", images: [img("i1"), img("i2"), img("i3")] },
    { role: "assistant" as const, content: "seen" },
    { role: "user" as const, content: "more", images: [img("i4"), img("i5"), img("i6")] },
  ];
  await llm.complete({ models: ["pa"], messages, tools: [], signal: new AbortController().signal });
  const urls = (body?.messages ?? []).flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as Array<{ type: string; image_url?: { url: string } }>).flatMap((p) =>
          p.type === "image_url" ? [p.image_url?.url.split(",")[1]] : [],
        )
      : [],
  );
  assert.deepEqual(urls, ["i3", "i4", "i5", "i6"]);
});

test("a server that cuts a long chat to its small context does not answer it; the reasons of every model come back", async () => {
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async (_url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      if (model === "m1") return new Response("You exceeded your current quota", { status: 429 });
      return sse([
        { choices: [{ delta: { content: "half-blind answer" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 4096, completion_tokens: 3 } },
      ]);
    }) as typeof fetch,
  });
  const shown: string[] = [];
  await assert.rejects(
    llm.complete({
      models: ["pa/m1", "pa/m2"],
      messages: [{ role: "user", content: "x".repeat(200_000) }],
      tools: [],
      signal: new AbortController().signal,
      onText: (t) => shown.push(t),
    }),
    (err: Error) => {
      assert.match(err.message, /^pa\/m1: .*quota/m);
      assert.match(err.message, /^pa\/m2: the server read only 4k tokens of this chat \(50k tokens\)/m);
      return true;
    },
  );
  assert.equal(shown.at(-1), "", "the cut answer does not stay on screen");
});

test("a small input figure that is not a context length is a prompt cache, not a cut: the answer stands", async () => {
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    fetchImpl: (async () =>
      sse([
        { choices: [{ delta: { content: "cached answer" }, finish_reason: "stop" }] },
        { choices: [], usage: { prompt_tokens: 812, completion_tokens: 3 } },
      ])) as typeof fetch,
  });
  const out = await llm.complete({
    models: ["pa/m2"],
    messages: [{ role: "user", content: "x".repeat(200_000) }],
    tools: [],
    signal: new AbortController().signal,
    onText: () => {},
  });
  assert.equal(out.message.content, "cached answer");
});

test("when the first model fails and the next answers, the answer says which failed and why", async () => {
  const llm = createLlm({
    providers: () => providers,
    secrets,
    firstByteMs: 1000,
    retryDelayMs: 5,
    fetchImpl: (async (_url: string, init: RequestInit) => {
      const model = (JSON.parse(String(init.body)) as { model: string }).model;
      if (model === "m1") return new Response("You exceeded your current quota", { status: 429 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    }) as typeof fetch,
  });
  const out = await llm.complete({
    models: ["pa/m1", "pa/m2"],
    messages: [{ role: "user", content: "hi" }],
    tools: [],
    signal: new AbortController().signal,
  });
  assert.equal(out.model, "pa/m2");
  assert.equal(out.failed?.length, 1);
  assert.equal(out.failed?.[0]?.model, "pa/m1");
  assert.match(out.failed?.[0]?.why ?? "", /quota/);
});
