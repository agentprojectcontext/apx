// send_file: the agent hands the owner a file from disk. These tests pin the
// delivery policy (images on by default, executables and credential folders
// never), the handler's queueing into the turn's media sink, and the Telegram
// half — including the regression that motivated the tool: a turn whose prose
// all streamed must still deliver the file it promised.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "apx-send-file-"));
process.env.APX_HOME = path.join(tmpHome, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { deliveryPolicy } = await import("#core/stores/file-delivery.js");
const { default: sendFile } = await import("#core/agent/tools/handlers/send-file.js");
const { attachmentsMeta } = await import("#core/stores/media-archive.js");
const { sendFinalReply } = await import("#core/channels/telegram/reply.js");
const { BASE_TOOL_NAMES } = await import("#core/agent/tools/registry.js");
const { TOOLS } = await import("#core/agent/tools/names.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "apx-send-file-work-"));
function file(name, bytes) {
  const p = path.join(work, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, bytes);
  return p;
}
const call = (args, ctx) => sendFile.makeHandler(ctx)(args);

test("policy — images on, everything else off by default", () => {
  const p = deliveryPolicy({});
  assert.deepEqual(p.kinds, { image: true, video: false, audio: false, document: false });
  assert.equal(p.max_mb, 20);
  const custom = deliveryPolicy({ file_delivery: { kinds: { document: true, image: false }, max_mb: 5 } });
  assert.equal(custom.kinds.document, true);
  assert.equal(custom.kinds.image, false);
  assert.equal(custom.max_mb, 5);
});

test("send_file — a real PNG is queued once, as a photo", () => {
  const png = file("shot.png", PNG);
  const sink = [];
  const r1 = call({ path: png, caption: "Google" }, { globalConfig: {}, mediaSink: sink });
  const r2 = call({ path: png }, { globalConfig: {}, mediaSink: sink });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(sink.length, 1, "the same file twice is delivered once");
  assert.equal(sink[0].kind, "photo");
  assert.equal(sink[0].mime, "image/png");
  assert.equal(sink[0].caption, "Google");
});

test("send_file — executables are refused even with every kind enabled", () => {
  const exe = file("setup.exe", Buffer.from("MZ...."));
  const all = { file_delivery: { kinds: { image: true, video: true, audio: true, document: true } } };
  const r = call({ path: exe }, { globalConfig: all, mediaSink: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /never sent/);
});

test("send_file — a document waits for the owner to enable documents", () => {
  const pdf = file("report.pdf", Buffer.from("%PDF-1.4 hello"));
  const off = call({ path: pdf }, { globalConfig: {}, mediaSink: [] });
  assert.equal(off.ok, false);
  assert.match(off.error, /turned off/);
  assert.deepEqual(off.allowed_kinds, ["image"]);

  const sink = [];
  const on = call({ path: pdf }, { globalConfig: { file_delivery: { kinds: { document: true } } }, mediaSink: sink });
  assert.equal(on.ok, true);
  assert.equal(sink[0].kind, "document");
});

test("send_file — a renamed file does not pass as an image", () => {
  const fake = file("not-really.png", Buffer.from("#!/bin/sh\necho hi\n"));
  const r = call({ path: fake }, { globalConfig: {}, mediaSink: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /not a \.png image/);
});

test("send_file — APX_HOME is off limits except its media folder", () => {
  const secretDir = path.join(process.env.APX_HOME, "private");
  fs.mkdirSync(secretDir, { recursive: true });
  const secret = path.join(secretDir, "x.png");
  fs.writeFileSync(secret, PNG);
  assert.equal(call({ path: secret }, { globalConfig: {}, mediaSink: [] }).ok, false);

  const mediaDir = path.join(process.env.APX_HOME, "media", "out");
  fs.mkdirSync(mediaDir, { recursive: true });
  const archived = path.join(mediaDir, "y.png");
  fs.writeFileSync(archived, PNG);
  assert.equal(call({ path: archived }, { globalConfig: {}, mediaSink: [] }).ok, true);
});

test("send_file — size limit, missing file, no sink", () => {
  const png = file("big.png", Buffer.concat([PNG, Buffer.alloc(2048)]));
  const small = call({ path: png }, { globalConfig: { file_delivery: { max_mb: 0.001 } }, mediaSink: [] });
  assert.equal(small.ok, false);
  assert.match(small.error, /limit/);

  assert.equal(call({ path: path.join(work, "nope.png") }, { globalConfig: {}, mediaSink: [] }).ok, false);

  const noSink = call({ path: file("s.png", PNG) }, { globalConfig: {} });
  assert.equal(noSink.ok, false);
  assert.match(noSink.error, /not available/);
});

test("send_file — a relative path means the turn's project, never the daemon's cwd", () => {
  file("proj/out/pic.png", PNG);
  const sink = [];
  const r = call({ path: "out/pic.png" }, {
    globalConfig: {}, mediaSink: sink, channelMeta: { projectPath: path.join(work, "proj") },
  });
  assert.equal(r.ok, true);
  assert.equal(path.basename(sink[0].path), "pic.png");
  assert.equal(call({ path: "out/pic.png" }, { globalConfig: {}, mediaSink: [] }).ok, false);
});

test("send_file is in the base tool set", () => {
  assert.ok(BASE_TOOL_NAMES.has(TOOLS.SEND_FILE));
});

test("attachmentsMeta — each item keeps its own kind", () => {
  const png = file("a.png", PNG);
  const pdf = file("b.pdf", Buffer.from("%PDF-1.4"));
  const meta = attachmentsMeta([
    { path: png, kind: "photo" },
    { path: pdf, kind: "document", mime: "application/pdf" },
  ]);
  assert.deepEqual(meta.media.map((m) => m.kind), ["photo", "document"]);
  assert.equal(meta.media_kind, "photo");
  for (const m of meta.media) {
    assert.ok(m.path.startsWith(fs.realpathSync(path.join(process.env.APX_HOME, "media"))), "archived under ~/.apx/media");
  }
});

function fakeTelegram() {
  const sent = [];
  return {
    sent,
    globalConfig: {},
    channel: { name: "main" },
    log: () => {},
    _send: async (a) => sent.push({ type: "text", ...a }),
    _sendPhoto: async (a) => sent.push({ type: "photo", ...a }),
    _sendDocument: async (a) => sent.push({ type: "document", ...a }),
  };
}

test("telegram — files go out after the reply: a photo as a photo, the rest as a document", async () => {
  const self = fakeTelegram();
  const png = file("t.png", PNG);
  const pdf = file("t.pdf", Buffer.from("%PDF-1.4"));
  await sendFinalReply(self, {
    chat_id: 1234567890, update_id: 1, replyText: "Listo, ahí va.", agentDisplay: "APX",
    saMedia: [
      { path: png, kind: "photo", mime: "image/png", file: "t.png", caption: "" },
      { path: pdf, kind: "document", mime: "application/pdf", file: "t.pdf", caption: "" },
    ],
  });
  assert.deepEqual(self.sent.map((s) => s.type), ["text", "photo", "document"]);
});

// The regression this tool exists for: the reply said "te la adjunto" and
// nothing arrived. When every word already streamed, sendFinalReply returned
// early — and would have dropped the files with it.
test("telegram — a turn whose text all streamed still delivers its files", async () => {
  const self = fakeTelegram();
  const png = file("streamed.png", PNG);
  await sendFinalReply(self, {
    chat_id: 1234567890, update_id: 2, replyText: "Te la adjunto.", lastStreamedText: "Te la adjunto.",
    streamedCount: 1, agentDisplay: "APX",
    saMedia: [{ path: png, kind: "photo", mime: "image/png", file: "streamed.png", caption: "" }],
  });
  assert.deepEqual(self.sent.map((s) => s.type), ["photo"]);
});
