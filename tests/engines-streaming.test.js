// Unit tests for src/core/engines/_streaming.js — the shared SSE / JSONL
// iterators used by anthropic.js and ollama.js. These run offline against
// a stubbed Response whose body is a ReadableStream we control, so we can
// exercise chunk-boundary cases without any LLM.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  streamLines,
  streamSseDataEvents,
  streamJsonLines,
} from "../src/core/engines/_streaming.js";

function streamFromChunks(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) { controller.close(); return; }
      controller.enqueue(enc.encode(chunks[i++]));
    },
  });
  return { body: stream };
}

async function collect(asyncIter) {
  const out = [];
  for await (const v of asyncIter) out.push(v);
  return out;
}

test("streamLines: split across chunk boundary", async () => {
  const res = streamFromChunks(["a\nb", "c\n", "d"]);
  const lines = await collect(streamLines(res));
  assert.deepEqual(lines, ["a", "bc", "d"]);
});

test("streamLines: yields empty lines (SSE relies on them)", async () => {
  const res = streamFromChunks(["x\n\ny\n"]);
  const lines = await collect(streamLines(res));
  assert.deepEqual(lines, ["x", "", "y"]);
});

test("streamLines: handles null body without throwing", async () => {
  const lines = await collect(streamLines({ body: null }));
  assert.deepEqual(lines, []);
});

test("streamSseDataEvents: parses Anthropic-style data lines, skips [DONE] and non-data", async () => {
  const res = streamFromChunks([
    'event: message_start\n',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":3,"output_tokens":0}}}\n',
    '\n',
    'event: content_block_delta\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}\n',
    '\n',
    'data: [DONE]\n',
  ]);
  const events = await collect(streamSseDataEvents(res));
  assert.equal(events.length, 2);
  assert.equal(events[0].type, "message_start");
  assert.equal(events[1].delta.text, "Hi");
});

test("streamSseDataEvents: invalid JSON in a data row is skipped, not thrown", async () => {
  const res = streamFromChunks([
    'data: not-json\n',
    'data: {"ok":true}\n',
  ]);
  const events = await collect(streamSseDataEvents(res));
  assert.deepEqual(events, [{ ok: true }]);
});

test("streamJsonLines: parses Ollama-style JSONL across boundary, ignores blanks", async () => {
  const res = streamFromChunks([
    '{"done":false,"message":{"content":"Hel"}}\n',
    '{"done":false,"message":{"content":"lo"}}\n',
    '\n',
    '{"done":true,"prompt_eval_count":3,"eval_count":2}\n',
  ]);
  const events = await collect(streamJsonLines(res));
  assert.equal(events.length, 3);
  assert.equal(events[0].message.content, "Hel");
  assert.equal(events[1].message.content, "lo");
  assert.equal(events[2].done, true);
});

test("streamJsonLines: malformed line dropped silently", async () => {
  const res = streamFromChunks([
    '{"a":1}\n',
    'garbage\n',
    '{"b":2}\n',
  ]);
  const events = await collect(streamJsonLines(res));
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }]);
});

test("streamLines: single-line response without trailing newline still yields", async () => {
  const res = streamFromChunks(["only-line-no-nl"]);
  const lines = await collect(streamLines(res));
  assert.deepEqual(lines, ["only-line-no-nl"]);
});
