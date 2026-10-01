import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ProviderConfig } from "../config.ts";
import { createSecrets } from "../secrets.ts";
import { toAnthropic } from "./anthropic-messages.ts";
import { createLlm } from "./llm.ts";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx2-llm-"));
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
    providers,
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

test("a named model goes first; quota moves on to the next model; providers without a key are never called", async () => {
  const seen: string[] = [];
  const llm = createLlm({
    providers,
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
  const out = await llm.complete({ model: "pb/m3", messages: [], tools: [], signal: new AbortController().signal });
  assert.deepEqual(seen, ["m3", "m1"]);
  assert.equal(out.model, "pa/m1");
  assert.equal(out.finish, "length");
  assert.equal(llm.label(), "pa/m1");
});

test("tool calls stream in fragments and keep provider extras", async () => {
  const llm = createLlm({
    providers: providers.slice(0, 1),
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
  const out = await llm.complete({ messages: [], tools: [], signal: new AbortController().signal, onText: () => {} });
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

test("a per-model quota (Gemini's 429) moves on to the same provider's next model", async () => {
  const seen: string[] = [];
  const llm = createLlm({
    providers: providers.slice(0, 1),
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
  const out = await llm.complete({ messages: [], tools: [], signal: new AbortController().signal });
  assert.deepEqual(seen, ["m1", "m2"]);
  assert.equal(out.model, "pa/m2");
});
