import assert from "node:assert/strict";
import { test } from "node:test";
import { readSpeechBody } from "./speech-body.ts";

test("provider response bounds apply to declared and chunked bytes before decoding", async () => {
  for (const declared of [true, false]) {
    let cancelled = false;
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(body, { headers: declared ? { "content-length": "20" } : {} });
    await assert.rejects(readSpeechBody(response, new AbortController().signal, 16), /too large/);
    assert.equal(cancelled, true);
    assert.ok(pulls <= 3, "a never-ending response is stopped without buffering it");
  }
});

test("a stalled speech body is cancelled when the call aborts", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const reading = readSpeechBody(response, controller.signal);
  controller.abort();
  await assert.rejects(reading, /abort/i);
  assert.equal(cancelled, true);
});

test("a bounded response is read without changing its bytes", async () => {
  assert.deepEqual(await readSpeechBody(new Response("hello"), new AbortController().signal), Buffer.from("hello"));
});
