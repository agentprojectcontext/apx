import assert from "node:assert/strict";
import { test } from "node:test";
import { createSecrets } from "../secrets.ts";
import { tempDir } from "../testkit/platform.ts";
import { REASONING, toInput } from "./chatgpt-responses.ts";
import { createLlm } from "./llm.ts";
import type { ChatItem } from "./types.ts";
import { readsImages } from "./vision.ts";
import { contextWindow } from "./windows.ts";

test("Responses does not replay another model's reasoning and preserves later developer notes", () => {
  const converted = toInput(
    [
      { role: "system", content: "Stable" },
      { role: "user", content: "Hi" },
      { role: "system", content: "Current guidance" },
      {
        role: "assistant",
        content: "Previous",
        [REASONING]: [{ model: "gpt-6.2-sol", summary: [], encrypted_content: "foreign" }],
      },
    ],
    "gpt-6.2-astra",
  );
  assert.equal(converted.instructions, "");
  assert.deepEqual(converted.input, [
    { type: "message", role: "developer", content: [{ type: "input_text", text: "Stable" }] },
    { type: "message", role: "user", content: [{ type: "input_text", text: "Hi" }] },
    { type: "message", role: "developer", content: [{ type: "input_text", text: "Current guidance" }] },
    { type: "message", role: "assistant", content: [{ type: "output_text", text: "Previous" }] },
  ]);
});

for (const [base, model] of [
  ["https://gateway.example.com/v1", "gpt-6.2-astra"],
  ["https://api.openai.com.example.com/v1", "gpt-6.2-sol"],
  ["https://api.openai.com/v1", "gpt-6.1-sol"],
  ["https://api.openai.com/v1", "gpt-6.20-sol"],
] as const) {
  test(`${base} with ${model} keeps its existing Chat Completions contract`, async () => {
    const home = tempDir("apx-gpt-boundary-");
    try {
      let calls = 0;
      const llm = createLlm({
        providers: () => [{ id: "acme", transport: "openai-chat", base_url: base, key: "none", models: [] }],
        secrets: createSecrets(home.path, "file", {}),
        firstByteMs: 5_000,
        fetchImpl: async (url, init) => {
          calls++;
          assert.equal(String(url), `${base}/chat/completions`);
          const body = JSON.parse(String(init?.body));
          assert.deepEqual(body.messages, [
            { role: "system", content: "Stable" },
            { role: "user", content: "Hi" },
          ]);
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "Unchanged" }, finish_reason: "stop" }] }),
          );
        },
      });
      const out = await llm.complete({
        models: [`acme/${model}#none`],
        once: true,
        messages: [
          { role: "system", content: "Stable" },
          { role: "user", content: "Hi" },
        ],
        tools: [],
        signal: new AbortController().signal,
      });
      assert.equal(out.message.content, "Unchanged");
      assert.equal(out.effort, "none");
      assert.equal(calls, 1);
    } finally {
      await home.remove();
    }
  });
}

test("GPT-6.2 context limits stop oversized calls before dispatch and Responses failures never retry as Chat Completions", async () => {
  const home = tempDir("apx-gpt-negative-");
  try {
    const seen: string[] = [];
    const llm = createLlm({
      providers: () => [
        { id: "acme", transport: "openai-chat", base_url: "https://api.openai.com/v1", key: "none", models: [] },
      ],
      secrets: createSecrets(home.path, "file", {}),
      firstByteMs: 5_000,
      fetchImpl: async (url) => {
        seen.push(String(url));
        return new Response(JSON.stringify({ error: { message: "Model not available for this account" } }), {
          status: 403,
        });
      },
    });
    const request = {
      models: ["acme/gpt-6.2-sol"],
      messages: [{ role: "user" as const, content: "x".repeat(4_200_100) }],
      tools: [],
      once: true,
      signal: new AbortController().signal,
    };
    await assert.rejects(llm.complete(request), /smaller than this chat/);
    assert.equal(seen.length, 0);
    await assert.rejects(
      llm.complete({ ...request, messages: [{ role: "user", content: "Hello" }] }),
      /Model not available/,
    );
    assert.deepEqual(seen, ["https://api.openai.com/v1/responses"]);
  } finally {
    await home.remove();
  }
});

for (const model of ["gpt-6.2-astra", "gpt-6.2-sol"]) {
  test(`${model} has documented metadata without inventing other variants`, () => {
    assert.equal(contextWindow(`openai/${model}`), 1_050_000);
    assert.equal(contextWindow(`chatgpt/${model}`), 500_000);
    assert.equal(contextWindow(`codex/${model}#high`), 500_000);
    assert.equal(readsImages(`openai/${model}`), true);
    assert.equal(contextWindow("openai/gpt-6.2-terra"), undefined);
    assert.equal(contextWindow("openai/gpt-6.20-sol"), undefined);
  });

  for (const transport of ["openai-chat", "chatgpt-responses"] as const) {
    test(`${model} over ${transport} preserves a tool round through Responses with stable instructions`, async () => {
      const home = tempDir("apx-gpt-62-");
      try {
        const seen: Array<Record<string, unknown>> = [];
        const llm = createLlm({
          providers: () => [{ id: "acme", transport, base_url: "https://api.openai.com/v1", key: "none", models: [] }],
          secrets: createSecrets(home.path, "file", {}),
          firstByteMs: 5_000,
          media: () => ({ mime: "image/png", data: "AAAA" }),
          fetchImpl: async (url, init) => {
            assert.equal(String(url), "https://api.openai.com/v1/responses", "tools must not use Chat Completions");
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            seen.push(body);
            assert.deepEqual(body.reasoning, { effort: seen.length === 1 ? "low" : "high", summary: "auto" });
            assert.equal(body.store, false);
            assert.equal(body.instructions, "");
            assert.equal(body.temperature, undefined);
            assert.equal(body.top_p, undefined);
            assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
            const events =
              seen.length === 1
                ? [
                    {
                      type: "response.output_item.done",
                      item: { type: "reasoning", summary: [], encrypted_content: "opaque" },
                    },
                    {
                      type: "response.output_item.done",
                      item: { type: "function_call", call_id: "c1", name: "lookup", arguments: "{}" },
                    },
                  ]
                : [{ type: "response.output_text.delta", delta: "Done" }];
            return new Response(
              [
                ...events,
                {
                  type: "response.completed",
                  response: { status: "completed", usage: { input_tokens: 24, output_tokens: 5 } },
                },
              ]
                .map((e) => `data: ${JSON.stringify(e)}\n\n`)
                .join(""),
              { headers: { "content-type": "text/event-stream" } },
            );
          },
        });
        const messages: ChatItem[] = [
          { role: "system", content: "Stable guidance" },
          { role: "user", content: "Look", images: [{ media_id: "med_image", mime: "image/png" }] },
        ];
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "lookup",
              description: "Look up a value",
              parameters: { type: "object", properties: {} },
            },
          },
        ];
        const request = {
          once: true,
          models: [`acme/${model}#${transport === "openai-chat" ? "minimal" : "none"}`],
          lighter: "minimal",
          messages,
          tools,
          signal: new AbortController().signal,
          cacheKey: "conversation",
        };
        const first = await llm.complete(request);
        assert.equal(first.finish, "tool_calls");
        assert.equal(first.effort, "low");
        assert.deepEqual(
          first.message.tool_calls?.map((c) => c.function.name),
          ["lookup"],
        );
        assert.ok(first.message[REASONING]);
        const second = await llm.complete({
          ...request,
          models: [`acme/${model}#high`],
          lighter: undefined,
          messages: [...messages, first.message, { role: "tool", tool_call_id: "c1", content: "Found" }],
        });
        assert.equal(second.message.content, "Done");
        assert.deepEqual(second.usage, { input: 24, output: 5 });
        const prefix = seen[0]?.input as unknown[];
        const replay = seen[1]?.input as Array<Record<string, unknown>>;
        assert.deepEqual(prefix[0], {
          type: "message",
          role: "developer",
          content: [{ type: "input_text", text: "Stable guidance" }],
        });
        assert.deepEqual(replay.slice(0, prefix.length), prefix, "an unchanged prefix stays byte-equivalent");
        assert.deepEqual(
          replay.slice(prefix.length).map((i) => i.type),
          ["reasoning", "function_call", "function_call_output"],
        );
        assert.deepEqual(replay.at(-1), { type: "function_call_output", call_id: "c1", output: "Found" });
        assert.deepEqual((prefix[1] as { content: unknown[] }).content, [
          { type: "input_text", text: "Look" },
          { type: "input_image", image_url: "data:image/png;base64,AAAA" },
        ]);
        assert.equal(seen[0]?.prompt_cache_key, seen[1]?.prompt_cache_key);
      } finally {
        await home.remove();
      }
    });
  }
}
