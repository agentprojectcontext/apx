// Inbound Telegram attachments: documents, video, video notes, GIFs — and
// images reaching a multimodal model as real image content.
//
// The reported failure: a file sent to the bot produced NOTHING. dispatch only
// recognised photo and voice/audio, so a document fell through to
// `text = msg.caption || ""`; with no caption that is empty, the turn is
// dropped, and the user cannot tell "unsupported" from "broken".

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-media-test-"));

const { detectIncomingFile, handleIncomingFile } = await import("#core/channels/telegram/inbound/file.js");
const { safeFileBase } = await import("#core/channels/telegram/media.js");
const gemini = (await import("#core/engines/gemini.js")).default;

function fakePoller() {
  const logs = [];
  return { logs, channel: { name: "default", bot_token: "t" }, log: (m) => logs.push(m) };
}

const CTX = (msg) => ({
  msg,
  u: { update_id: 1 },
  author: "@manu",
  chat_id: 42,
  text: msg.caption || "",
  incoming: detectIncomingFile(msg),
});

// Telegram's getFile + download, stubbed.
function stubTelegramDownload(bytes = "hello") {
  const original = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes("/getFile")) {
      return { ok: true, json: async () => ({ ok: true, result: { file_path: "documents/file_9.bin" } }) };
    }
    return { ok: true, arrayBuffer: async () => Buffer.from(bytes) };
  };
  return () => { global.fetch = original; };
}

test("a document is detected, where a caption-less file used to vanish", () => {
  assert.equal(detectIncomingFile({ document: { file_id: "d1" } })?.type, "document");
  assert.equal(detectIncomingFile({ video: { file_id: "v1" } })?.type, "video");
  assert.equal(detectIncomingFile({ video_note: { file_id: "n1" } })?.type, "video");
  assert.equal(detectIncomingFile({ animation: { file_id: "a1" } })?.type, "animation");
  assert.equal(detectIncomingFile({ text: "hola" }), null);
  assert.equal(detectIncomingFile({}), null);
});

test("a document is downloaded under its own name and described to the agent", async () => {
  const restore = stubTelegramDownload();
  try {
    const self = fakePoller();
    const msg = {
      message_id: 5,
      from: { id: 7 },
      document: { file_id: "abcdef123456", file_name: "informe anual.pdf", file_size: 2048, mime_type: "application/pdf" },
    };
    const { text } = await handleIncomingFile(self, CTX(msg));
    // Never an empty turn — that is what made the bot silent.
    assert.ok(text.trim().length > 0);
    assert.match(text, /informe anual\.pdf/, "the agent is told the real filename");
    assert.match(text, /2 KB/, "and the size");
    assert.match(text, /saved to .*informe anual-123456\.pdf/, "saved under a readable name");
    const saved = self.logs.find((l) => l.includes("document saved:"));
    assert.ok(saved, `expected a save log, got ${JSON.stringify(self.logs)}`);
    assert.ok(fs.existsSync(saved.split("document saved: ")[1]), "the file is really on disk");
  } finally {
    restore();
  }
});

test("a caption is kept alongside the file description", async () => {
  const restore = stubTelegramDownload();
  try {
    const msg = { message_id: 6, from: { id: 7 }, caption: "miralo y decime", document: { file_id: "zz999999", file_name: "a.txt" } };
    const { text } = await handleIncomingFile(fakePoller(), CTX(msg));
    assert.match(text, /miralo y decime/);
    assert.match(text, /a\.txt/);
  } finally {
    restore();
  }
});

test("a failed download is reported, not swallowed", async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ ok: false, description: "file is too big" }) });
  try {
    const msg = { message_id: 7, from: { id: 7 }, document: { file_id: "big1", file_name: "huge.zip" } };
    const { text } = await handleIncomingFile(fakePoller(), CTX(msg));
    assert.match(text, /FAILED/i, "the agent must know there is no local copy");
    assert.match(text, /20 MB/, "and why, so it can explain it");
  } finally {
    global.fetch = original;
  }
});

test("safeFileBase refuses path escapes and keeps something usable", () => {
  assert.equal(safeFileBase("../../etc/passwd"), "passwd");
  assert.equal(safeFileBase("informe anual.pdf"), "informe anual");
  assert.equal(safeFileBase("../../.."), "");
  assert.equal(safeFileBase(""), "");
  assert.ok(!safeFileBase("a".repeat(200)).includes("/"));
  assert.ok(safeFileBase("a".repeat(200)).length <= 60);
});

test("an image on the turn reaches Gemini as real image content", async () => {
  const captured = {};
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return {
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "veo un gato" }] } }], usageMetadata: {} }),
    };
  };
  try {
    await gemini.chat({
      messages: [
        { role: "user", content: "¿qué ves?", images: [{ mime: "image/jpeg", data: "QUJD" }] },
      ],
      model: "gemini-3.5-flash",
      config: { api_key: "k" },
    });
    const parts = captured.body.contents[0].parts;
    const inline = parts.find((p) => p.inlineData);
    assert.ok(inline, `no image part sent: ${JSON.stringify(parts)}`);
    assert.equal(inline.inlineData.mimeType, "image/jpeg");
    assert.equal(inline.inlineData.data, "QUJD");
    assert.ok(parts.some((p) => p.text === "¿qué ves?"), "the text still rides along");
  } finally {
    global.fetch = original;
  }
});

test("an assistant turn never carries images back to the model", async () => {
  const captured = {};
  const original = global.fetch;
  global.fetch = async (url, init) => {
    captured.body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "ok" }] } }], usageMetadata: {} }) };
  };
  try {
    await gemini.chat({
      messages: [{ role: "assistant", content: "hola", images: [{ mime: "image/png", data: "XX" }] }],
      model: "gemini-3.5-flash",
      config: { api_key: "k" },
    });
    const parts = captured.body.contents[0].parts;
    assert.ok(!parts.some((p) => p.inlineData), "images belong to user turns only");
  } finally {
    global.fetch = original;
  }
});
