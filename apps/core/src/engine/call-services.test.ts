import assert from "node:assert/strict";
import { test } from "node:test";
import { waitFor } from "../testkit/platform.ts";
import { createCallServices } from "./call-services.ts";

function setup() {
  const sent: object[] = [];
  const requests: { kind: string; data: string; service: string | undefined; signal: AbortSignal }[] = [];
  const failed: string[] = [];
  const bridge = createCallServices({
    speech: "voice",
    transcription: "ears",
    send: (f) => sent.push(f),
    failed: (op) => failed.push(op),
    services: {
      async callSpeech(data, service, signal) {
        requests.push({ kind: "speak", data, service, signal });
        return Buffer.from([1, 2]);
      },
      async callTranscribe(data, service, signal) {
        requests.push({ kind: "transcribe", data: data.toString("base64"), service, signal });
        return "Hello";
      },
    },
  });
  return { bridge, sent, requests, failed };
}

test("private call requests use the selected services and return only audio or text", async () => {
  const s = setup();
  try {
    assert.equal(s.bridge.receive({ type: "state", state: "listening" }), false);
    s.bridge.receive({ type: "service", id: 1, operation: "speak", text: "Hello" });
    s.bridge.receive({ type: "service", id: 2, operation: "transcribe", audio: "AQI=" });
    await waitFor(() => s.sent.length === 2, "both service results");
    assert.deepEqual(s.sent, [
      { type: "service_result", id: 1, audio: "AQI=" },
      { type: "service_result", id: 2, text: "Hello" },
    ]);
    assert.deepEqual(
      s.requests.map(({ kind, service }) => ({ kind, service })),
      [
        { kind: "speak", service: "voice" },
        { kind: "transcribe", service: "ears" },
      ],
    );
    assert.deepEqual(s.failed, []);
  } finally {
    s.bridge.close();
  }
});

test("a panel-like frame cannot select an endpoint or another operation", () => {
  const s = setup();
  try {
    s.bridge.receive({ type: "service", id: 1, operation: "fetch", url: "http://example.com" });
    s.bridge.receive({ type: "service", id: 2, operation: "transcribe", audio: "invalid!" });
    s.bridge.receive({ type: "service", id: 3, operation: "speak", text: "x".repeat(4001) });
    assert.deepEqual(s.requests, []);
    assert.equal(s.sent.length, 3);
    assert.ok(s.sent.every((f) => "error" in f));
  } finally {
    s.bridge.close();
  }
});

test("interrupting speech aborts its request and cannot publish a late result", async () => {
  const sent: object[] = [];
  let signal: AbortSignal | undefined;
  let resolve: (audio: Buffer) => void = () => {};
  const bridge = createCallServices({
    services: {
      callSpeech(_text, _service, abort) {
        signal = abort;
        return new Promise((done) => {
          resolve = done;
        });
      },
      async callTranscribe() {
        throw new Error("unexpected");
      },
    },
    send: (f) => sent.push(f),
    failed: () => assert.fail("cancellation is not a service failure"),
  });
  bridge.receive({ type: "service", id: 1, operation: "speak", text: "Hello" });
  bridge.receive({ type: "service_cancel", id: 1 });
  assert.equal(signal?.aborted, true);
  resolve(Buffer.from([1, 2]));
  await new Promise<void>((done) => setImmediate(done));
  assert.deepEqual(sent, []);
  bridge.close();
});

test("call speech accepts bounded PCM beyond one socket megabyte but rejects empty, odd and oversized audio", async () => {
  for (const size of [0, 1, 4 * 1024 * 1024, 4 * 1024 * 1024 + 2]) {
    const sent: object[] = [];
    const failures: string[] = [];
    const pcm = Buffer.alloc(size);
    const bridge = createCallServices({
      services: { callSpeech: async () => pcm, callTranscribe: async () => "unexpected" },
      send: (frame) => sent.push(frame),
      failed: (op) => failures.push(op),
    });
    try {
      bridge.receive({ type: "service", id: 1, operation: "speak", text: "Hello" });
      await waitFor(() => sent.length === 1, "the bounded service reply");
      if (size === 4 * 1024 * 1024) {
        assert.deepEqual(sent, [{ type: "service_result", id: 1, audio: pcm.toString("base64") }]);
        assert.deepEqual(failures, []);
      } else {
        assert.deepEqual(sent, [{ type: "service_result", id: 1, error: true }]);
        assert.deepEqual(failures, ["speak"]);
      }
    } finally {
      bridge.close();
    }
  }
});

test("a service error settles its request without exposing provider details", async () => {
  const sent: object[] = [];
  const failed: string[] = [];
  const bridge = createCallServices({
    services: {
      async callSpeech() {
        throw new Error("private provider response");
      },
      async callTranscribe() {
        throw new Error("unexpected");
      },
    },
    send: (f) => sent.push(f),
    failed: (op) => failed.push(op),
  });
  try {
    bridge.receive({ type: "service", id: 1, operation: "speak", text: "Hello" });
    await waitFor(() => failed.length === 1, "the call failure");
    assert.deepEqual(sent, [{ type: "service_result", id: 1, error: true }]);
    assert.deepEqual(failed, ["speak"]);
  } finally {
    bridge.close();
  }
});
