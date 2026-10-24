import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { callTool, say, scriptedLlm, startCore } from "../engine/testkit.ts";
import { waitFor } from "../testkit/platform.ts";
import { fakeTelegram } from "./fake-telegram.test-support.ts";
import { telegramAdapter } from "./telegram.ts";

const TOKEN = "123456:TEST-media";
const OWNER = { id: 4004, name: "Owner" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** One fake server for the three media services: an A1111, a speech server and a local whisper. */
const media = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    const json = (j: object) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(j));
    };
    if (req.url === "/sdapi/v1/txt2img") return json({ images: [PNG.toString("base64")], info: "{}" });
    if (req.url === "/v1/audio/speech") {
      res.writeHead(200, { "content-type": "audio/wav" });
      return res.end(Buffer.from("RIFF-not-really-wav"));
    }
    if (req.url === "/transcribe") return json({ text: "quiero un dibujo de un zorro" });
    res.writeHead(200);
    res.end("{}");
  });
});

const llm = scriptedLlm((_req, { said, afterTool }) => {
  if (said.includes("mandame el reel"))
    return afterTool ? say("Here is the reel.") : callTool("f1", "send_file", { path: "reel.mp4" });
  if (afterTool) return say("Here is your fox, drawn.");
  if (said.includes("[voice note] quiero un dibujo")) return callTool("d1", "make_image", { prompt: "a fox" });
  return say("ok");
});

let env: Awaited<ReturnType<typeof startCore>>;
let tg: Awaited<ReturnType<typeof fakeTelegram>>;

before(async () => {
  await new Promise<void>((r) => media.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(media.address() as AddressInfo).port}`;
  tg = await fakeTelegram(TOKEN);
  env = await startCore({ llm, channelAdapters: { telegram: (c, t) => telegramAdapter(c, t, tg.url) } });
  const svc = (kind: "image" | "speech" | "transcription", dialect: "a1111" | "openai-speech" | "whisper-local") => ({
    kind,
    dialect,
    label: kind,
    base_url: url,
    enabled: true,
    needs_key: false,
  });
  await env.client.call("services.set", { id: "draw", service: svc("image", "a1111") });
  await env.client.call("services.set", { id: "voice", service: svc("speech", "openai-speech") });
  await env.client.call("services.set", { id: "ears", service: svc("transcription", "whisper-local") });
  await env.client.call("channels.set", { id: "tg", channel: { type: "telegram", agent_id: "roby" }, token: TOKEN });
  // The owner pairs once.
  tg.message(OWNER, "hola");
  await waitFor(() => tg.messagesTo(OWNER.id).length === 1, "pairing code");
  const code = /(\d{6})/.exec(String(tg.messagesTo(OWNER.id)[0]?.body.text))?.[1] ?? "";
  await env.client.call("pairing.respond", { code, decision: "owner" });
});
after(async () => {
  await env.core.close();
  await tg.close();
  await new Promise<void>((r) => media.close(() => r()));
  await env.cleanup();
});

test("a voice note is heard, the agent draws, and the answer returns as a voice note with its words, and the photo", async () => {
  await env.client.call("threads.voice", { thread: "home", on: true });
  tg.voice(OWNER);
  await waitFor(() => tg.sent.some((s) => s.method === "sendPhoto"), "the photo", { ms: 8000 });
  await waitFor(() => tg.sent.some((s) => s.method === "sendVoice" || s.method === "sendAudio"), "the voice", {
    ms: 8000,
  });
  // What the voice note says rides with it as its caption, not as a separate message.
  const voice = tg.sent.find((s) => s.method === "sendVoice" || s.method === "sendAudio");
  assert.match(String(voice?.body.caption), /fox, drawn/);
  assert.ok(!tg.messagesTo(OWNER.id).some((m) => /fox, drawn/.test(String(m.body.text))));
  const home = await env.client.call("threads.get", { thread: "home" });
  assert.ok(
    home.messages.some(
      (m) =>
        m.author.kind === "user" &&
        m.parts.some((p) => p.type === "text" && p.text.includes("[voice note] quiero un dibujo")),
    ),
  );
  assert.ok(home.messages.some((m) => m.parts.some((p) => p.type === "image" && p.media_id)));
  const recording = home.messages.find((m) => m.author.kind === "user")?.parts.find((p) => p.type === "audio");
  assert.ok(recording);
  const saved = await env.client.call("media.get", { id: recording.media_id });
  assert.equal(saved.mime, "audio/ogg");
  assert.equal(Buffer.from(saved.data, "base64").toString(), "OggS-fake-voice");
});

test("a file the agent attaches on a channel turn reaches the channel, with or without a voice note", async () => {
  fs.mkdirSync(path.join(env.home, "work"), { recursive: true });
  fs.writeFileSync(path.join(env.home, "work", "reel.mp4"), Buffer.alloc(2048, 1));
  for (const voice of [false, true]) {
    await env.client.call("threads.voice", { thread: "home", on: voice });
    const before = tg.filesTo(OWNER.id).filter((s) => s.method === "sendDocument").length;
    tg.message(OWNER, "mandame el reel");
    await waitFor(
      () => tg.filesTo(OWNER.id).filter((s) => s.method === "sendDocument").length > before,
      `the reel as a document (voice ${voice})`,
      { ms: 8000 },
    );
    const doc = tg
      .filesTo(OWNER.id)
      .filter((s) => s.method === "sendDocument")
      .at(-1);
    assert.equal(doc?.body.filename, "reel.mp4");
    await env.settle("home");
  }
});

test("a channel voice note stays playable when no transcription engine is configured", async () => {
  await env.client.call("services.set", { id: "ears", service: null });
  const before = env.core.store.messages.list("home").length;
  tg.voice(OWNER);
  await waitFor(() => env.core.store.messages.list("home").length > before, "the voice without transcription");
  const message = env.core.store.messages
    .list("home")
    .slice(before)
    .find((m) => m.author.kind === "user");
  assert.ok(message?.parts.some((p) => p.type === "audio"));
  assert.ok(message?.parts.some((p) => p.type === "text" && p.text.includes("no transcription engine")));
});
