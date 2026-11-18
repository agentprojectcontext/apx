import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { createLog } from "../log.ts";
import { createServices } from "./registry.ts";

test("path-based call transcription supplies a WAV and removes it on success or failure without keeping media", async () => {
  const env = await startCore({ llm: scriptedLlm(() => say("ok")) });
  let requestPath = "";
  let fail = false;
  let kept = 0;
  const services = createServices({
    store: {
      ...env.core.store,
      media: {
        ...env.core.store.media,
        add: (m) => {
          kept++;
          return env.core.store.media.add(m);
        },
      },
    },
    secrets: env.core.secrets,
    home: env.home,
    log: createLog("test", true),
    fetch: async (_url, init) => {
      requestPath = JSON.parse(String(init?.body)).audio_path;
      assert.ok(requestPath);
      assert.equal(fs.readFileSync(requestPath).subarray(0, 4).toString(), "RIFF");
      if (fail) throw new Error("offline");
      return Response.json({ text: "Hello" });
    },
  });
  try {
    services.set("ears", {
      kind: "transcription",
      dialect: "whisper-local",
      label: "Whisper",
      base_url: "http://127.0.0.1:8000",
      enabled: true,
      needs_key: false,
    });
    const signal = new AbortController().signal;
    assert.equal(await services.callTranscribe(Buffer.alloc(320), "ears", signal), "Hello");
    assert.equal(fs.existsSync(requestPath), false);
    fail = true;
    await assert.rejects(services.callTranscribe(Buffer.alloc(320), "ears", signal));
    assert.equal(fs.existsSync(requestPath), false);
    assert.equal(kept, 0);
  } finally {
    services.close();
    await env.core.close();
    await env.cleanup();
  }
});
