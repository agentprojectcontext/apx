import assert from "node:assert/strict";
import { test } from "node:test";
import { reach } from "./reach.ts";
import { speak } from "./speech.ts";
import type { ServiceConfig } from "./types.ts";

const service: ServiceConfig = {
  id: "speech",
  label: "ElevenLabs",
  kind: "speech",
  dialect: "elevenlabs-speech",
  enabled: true,
  needs_key: true,
  base_url: "https://api.elevenlabs.io",
  voice: "test/voice",
};

test("ElevenLabs uses its native API and authentication and returns playable MP3", async () => {
  const result = await speak(
    service,
    { text: "Hello" },
    "test-key",
    new AbortController().signal,
    async (url, init) => {
      assert.equal(String(url), "https://api.elevenlabs.io/v1/text-to-speech/test%2Fvoice?output_format=mp3_44100_128");
      assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-key");
      assert.equal(new Headers(init?.headers).get("authorization"), null);
      assert.deepEqual(JSON.parse(String(init?.body)), { text: "Hello", model_id: "eleven_multilingual_v2" });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
    },
  );
  assert.equal(result.mime, "audio/mpeg");
  assert.deepEqual(result.bytes, Buffer.from("ID3"));
});

test("ElevenLabs requires a voice and key without sending a request", async () => {
  const unexpected = async () => {
    throw new Error("unexpected request");
  };
  await assert.rejects(
    speak(service, { text: "Hello" }, undefined, new AbortController().signal, unexpected),
    /API key/,
  );
  await assert.rejects(
    speak({ ...service, voice: undefined }, { text: "Hello" }, "test-key", new AbortController().signal, unexpected),
    /choose.*voice/,
  );
});

test("ElevenLabs connection check lists speech-capable models with native auth", async () => {
  const result = await reach(service, "/v1/models", "test-key", async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "test-key");
    return Response.json([
      { model_id: "speaks", can_do_text_to_speech: true },
      { model_id: "listens", can_do_text_to_speech: false },
    ]);
  });
  assert.deepEqual(result, { ok: true, models: ["speaks"] });
});

test("ElevenLabs propagates rejection and cancellation", async () => {
  await assert.rejects(
    speak(
      service,
      { text: "Hello" },
      "test-key",
      new AbortController().signal,
      async () => new Response("unauthorized", { status: 401 }),
    ),
    /HTTP 401/,
  );
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(
    speak(service, { text: "Hello" }, "test-key", stop.signal, async (_url, init) => {
      init?.signal?.throwIfAborted();
      throw new Error("request must be aborted");
    }),
    /abort/i,
  );
});
