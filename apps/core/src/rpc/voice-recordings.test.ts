import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { say, scriptedLlm, startCore } from "../engine/testkit.ts";

const bytes = Buffer.from("RIFF-voice-recording");
let fail = false;
let calls = 0;
const transcription = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url === "/transcribe") calls++;
    res.writeHead(fail ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(fail ? { error: "transcription offline" } : { text: "Check the duplicate posts" }));
  });
});
let env: Awaited<ReturnType<typeof startCore>>;
before(async () => {
  await new Promise<void>((r) => transcription.listen(0, "127.0.0.1", r));
  env = await startCore({ llm: scriptedLlm(() => say("Checked")) });
  await env.client.call("services.set", {
    id: "ears",
    service: {
      kind: "transcription",
      dialect: "whisper-local",
      label: "Transcription",
      enabled: true,
      needs_key: false,
      base_url: `http://127.0.0.1:${(transcription.address() as AddressInfo).port}`,
    },
  });
});
after(async () => {
  await env.core.close();
  await new Promise<void>((r) => transcription.close(() => r()));
  await env.cleanup();
});

test("an uploaded voice note keeps its bytes and transcript through send, reload and rewind without a second audio file", async () => {
  const { media } = await env.client.call("media.upload", {
    name: "Voice note.wav",
    mime: "audio/wav",
    data: bytes.toString("base64"),
    thread: "home",
  });
  assert.equal(media.kind, "audio");
  const count = env.core.store.media.get(media.id);
  const rows = fs.readdirSync(path.join(env.home, "media"), { recursive: true });
  const { text } = await env.client.call("media.transcribe", { media_id: media.id, thread: "home" });
  assert.equal(text, "Check the duplicate posts");
  assert.deepEqual(fs.readdirSync(path.join(env.home, "media"), { recursive: true }), rows);
  assert.deepEqual(env.core.store.media.get(media.id), count);
  const { message } = await env.client.call("threads.send", { thread: "home", text, attachments: [media.id] });
  assert.deepEqual(message.parts, [
    { type: "text", text },
    { type: "audio", media_id: media.id, mime: media.mime },
  ]);
  await env.settle("home");
  const loaded = await env.client.call("threads.get", { thread: "home" });
  assert.deepEqual(loaded.messages.find((m) => m.id === message.id)?.parts, message.parts);
  const saved = await env.client.call("media.get", { id: media.id });
  assert.deepEqual(Buffer.from(saved.data, "base64"), bytes);
  const rewound = await env.client.call("threads.rewind", { thread: "home", message: message.id, text: "Check again" });
  assert.ok(rewound.message.parts.some((p) => p.type === "audio" && p.media_id === media.id));
  await env.settle("home");
});

test("another chat cannot transcribe or attach an uploaded recording, and malformed requests never call the service", async () => {
  const other = await env.client.call("threads.create", { kind: "loose", agent_id: "roby" });
  const { media } = await env.client.call("media.upload", {
    name: "Other.wav",
    mime: "audio/wav",
    data: bytes.toString("base64"),
    thread: other.id,
  });
  const before = calls;
  await assert.rejects(env.client.call("media.transcribe", { media_id: media.id, thread: "home" }), /no audio upload/);
  await assert.rejects(env.client.call("media.transcribe", { media_id: media.id }), /no audio upload/);
  await assert.rejects(
    env.client.call("media.transcribe", { media_id: media.id, data: "x", mime: "audio/wav", thread: other.id }),
    /invalid params/,
  );
  await assert.rejects(
    env.client.call("threads.send", { thread: "home", text: "Check", attachments: [media.id] }),
    /no attachment/,
  );
  assert.equal(calls, before);
});

test("the socket accepts an audio upload above the old frame limit and transcribes the same stored file", async () => {
  const socket = await env.client.connect();
  try {
    const recording = Buffer.alloc(7 * 1024 * 1024, 1);
    const { media } = await socket.call("media.upload", {
      name: "Long voice.wav",
      mime: "audio/wav",
      data: recording.toString("base64"),
      thread: "home",
    });
    const { text } = await socket.call("media.transcribe", { media_id: media.id, thread: "home" });
    assert.equal(text, "Check the duplicate posts");
    const saved = await socket.call("media.get", { id: media.id });
    assert.deepEqual(Buffer.from(saved.data, "base64"), recording);
  } finally {
    socket.close();
  }
});

test("transcription failure preserves the uploaded recording, while oversized and empty audio are refused", async () => {
  fail = true;
  const { media } = await env.client.call("media.upload", {
    name: "Voice.webm",
    mime: "audio/webm;codecs=opus",
    data: bytes.toString("base64"),
    thread: "home",
  });
  await assert.rejects(
    env.client.call("media.transcribe", { media_id: media.id, thread: "home" }),
    /transcription offline/,
  );
  assert.equal((await env.client.call("media.get", { id: media.id })).data, bytes.toString("base64"));
  await assert.rejects(env.client.call("media.upload", { name: "Empty.wav", mime: "audio/wav", data: "" }), /empty/);
  await assert.rejects(
    env.client.call("media.upload", {
      name: "Large.wav",
      mime: "audio/wav",
      data: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
    }),
    /over 10 MB/,
  );
});

test("the live words while recording come only from whisper.cpp on this machine, and nothing is kept", async () => {
  const before = { calls, files: fs.readdirSync(path.join(env.home, "media"), { recursive: true }) };
  const heard = await env.client.call("media.listen", { data: bytes.toString("base64"), mime: "audio/webm" });
  assert.deepEqual(heard, { text: "", live: false });
  assert.equal(calls, before.calls);
  assert.deepEqual(fs.readdirSync(path.join(env.home, "media"), { recursive: true }), before.files);
});
