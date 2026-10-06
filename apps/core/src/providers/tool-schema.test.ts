import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineTool, toSpec } from "../tools/types.ts";
import { openaiChat } from "./openai-chat.ts";
import { grammarSchema } from "./tool-schema.ts";
import type { ToolSpec } from "./types.ts";

const tool = defineTool({
  name: "show_widget",
  description: "Show a widget",
  args: z.object({
    title: z.string().max(8000),
    worker: z.object({ slug: z.string().regex(/^[a-z]+$/) }).optional(),
    pattern: z.string().max(20).optional(),
    maxLength: z.number().optional(),
  }),
  effect: "local",
  deadlineMs: 1000,
  title: () => "Widget",
  async run() {
    return "ok";
  },
});

test("OpenAI grammar schemas keep tool properties and validation while omitting expensive string constraints", async () => {
  const spec = toSpec(tool);
  let sent: ToolSpec[] = [];
  await openaiChat({
    baseUrl: "http://example.test/v1",
    key: "",
    model: "local",
    messages: [{ role: "user", content: "Show" }],
    tools: [spec],
    signal: new AbortController().signal,
    firstByteMs: 1000,
    fetchImpl: (async (_url, init) => {
      sent = (JSON.parse(String(init?.body)) as { tools: ToolSpec[] }).tools;
      const parameters = sent[0]?.function.parameters as { properties: Record<string, Record<string, unknown>> };
      assert.ok(parameters.properties.pattern);
      assert.ok(parameters.properties.maxLength);
      assert.equal(parameters.properties.title?.maxLength, undefined);
      assert.equal(
        (parameters.properties.worker?.properties as Record<string, Record<string, unknown>> | undefined)?.slug
          ?.pattern,
        undefined,
      );
      return new Response(
        JSON.stringify({ choices: [{ message: { role: "assistant", content: "Shown" }, finish_reason: "stop" }] }),
      );
    }) as typeof fetch,
  });
  assert.equal(sent.length, 1);
  assert.equal(tool.parse({ title: "x".repeat(8001) }).ok, false);
  assert.equal(tool.parse({ title: "fine", worker: { slug: "INVALID!" } }).ok, false);
  assert.equal(tool.parse({ title: "fine", worker: { slug: "valid" } }).ok, true);
  assert.match(JSON.stringify(spec), /"maxLength":8000/);
  assert.match(JSON.stringify(spec), /"pattern":"\^\[a-z\]\+\$"/);
});

test("nested alternatives and array schemas adapt without altering literal enum or default data", () => {
  const literal = { pattern: "keep", maxLength: 42 };
  const original = {
    type: "object",
    default: literal,
    enum: [literal],
    properties: {
      values: {
        type: "array",
        items: { anyOf: [{ type: "string", pattern: "^[a-z]+$", maxLength: 8000 }, { type: "number" }] },
      },
    },
    $defs: { value: { type: "string", pattern: "^x$" } },
  };
  assert.deepEqual(grammarSchema(original), {
    type: "object",
    default: literal,
    enum: [literal],
    properties: { values: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] } } },
    $defs: { value: { type: "string" } },
  });
  assert.equal(original.$defs.value.pattern, "^x$");
});
