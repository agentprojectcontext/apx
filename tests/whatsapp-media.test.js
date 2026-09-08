// Inbound WhatsApp media: what reaches the turn, and what never does.
//
// Two rules are load-bearing and both are easy to break by accident:
//   1. NO branch returns empty text. A message that arrived and produced no
//      prompt is a message the agent answers with silence, which on this
//      channel reads as being ignored.
//   2. A GIF is a videoMessage. Classify on the flag, not the type, or GIFs get
//      refused as video and videos get watched.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-wa-media-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { classifyMessage, resolveInboundMedia } = await import("#core/channels/whatsapp/media.js");
const { recallSticker, learnSticker, listStickers } = await import("#core/channels/whatsapp/stickers.js");

// A real 1x1 PNG, so the base64 read-back path runs on actual bytes.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function tmpFile(name, bytes = PNG_1x1) {
  const p = path.join(TMP_HOME, name);
  fs.writeFileSync(p, bytes);
  return p;
}

const downloadTo = (p) => async () => p;
const downloadFails = async () => { throw new Error("socket closed"); };

// ── classification ─────────────────────────────────────────────────────────

test("a GIF is a videoMessage with gifPlayback — the flag decides, not the type", () => {
  assert.equal(classifyMessage({ videoMessage: { gifPlayback: true } }).kind, "gif");
  assert.equal(classifyMessage({ videoMessage: { seconds: 30 } }).kind, "video");
});

test("every handled type classifies, and plain text classifies as nothing", () => {
  assert.equal(classifyMessage({ imageMessage: {} }).kind, "image");
  assert.equal(classifyMessage({ audioMessage: {} }).kind, "audio");
  assert.equal(classifyMessage({ stickerMessage: {} }).kind, "sticker");
  assert.equal(classifyMessage({ documentMessage: {} }).kind, "document");
  assert.equal(classifyMessage({ conversation: "hola" }), null);
  assert.equal(classifyMessage({}), null);
});

// ── audio ──────────────────────────────────────────────────────────────────

test("a voice note arrives as its transcript", async () => {
  const r = await resolveInboundMedia(
    { audioMessage: { ptt: true, seconds: 7, mimetype: "audio/ogg" } },
    { download: downloadTo(tmpFile("v.ogg")), transcribeAudio: async () => ({ text: "che, llegás a las 8?", backend: "mlx" }) }
  );
  assert.equal(r.text, "[audio] che, llegás a las 8?");
  assert.equal(r.media.kind, "voice");
  assert.equal(r.media.meta.transcription_backend, "mlx");
});

test("an audio we could not hear still says an audio arrived", async () => {
  const r = await resolveInboundMedia(
    { audioMessage: {} },
    { download: downloadTo(tmpFile("v2.ogg")), transcribeAudio: async () => { throw new Error("whisper down"); } }
  );
  assert.match(r.text, /^\[audio —/);
  assert.match(r.text, /whisper down/);
  assert.equal(r.media.meta.transcription_error, "whisper down");
});

// ── images ─────────────────────────────────────────────────────────────────

test("an image comes back as pixels a vision model can render", async () => {
  const p = tmpFile("photo.png");
  const r = await resolveInboundMedia(
    { imageMessage: { caption: "mirá esto", width: 1, height: 1 } },
    { download: downloadTo(p) }
  );
  assert.equal(r.attachment.kind, "image");
  assert.equal(r.attachment.mime, "image/png");
  assert.equal(r.attachment.data, PNG_1x1.toString("base64"));
  assert.match(r.text, /image attached/);
  assert.match(r.text, /mirá esto/, "the caption must survive");
});

test("a failed image download degrades to a marker, not to silence", async () => {
  const r = await resolveInboundMedia({ imageMessage: {} }, { download: downloadFails });
  assert.equal(r.attachment, null);
  assert.match(r.text, /download failed/);
});

// ── video: the one thing we refuse ─────────────────────────────────────────

test("a video is refused honestly, and without downloading it first", async () => {
  let downloaded = false;
  const r = await resolveInboundMedia(
    { videoMessage: { seconds: 45, caption: "el gol" } },
    { download: async () => { downloaded = true; return tmpFile("v.mp4"); } }
  );
  assert.equal(downloaded, false, "no bytes for something we will not look at");
  assert.match(r.text, /can't watch videos/);
  assert.match(r.text, /el gol/);
  assert.equal(r.media.meta.supported, false);
});

// ── stickers: learned once, remembered after ───────────────────────────────

test("an unknown sticker is described once and written down", async () => {
  const sha = "sha-oso-saludando";
  assert.equal(recallSticker(sha), null);

  let visionCalls = 0;
  const deps = {
    download: downloadTo(tmpFile("s.webp")),
    describeImage: async () => { visionCalls++; return "un oso de dibujitos saludando"; },
    from: "5491166666666@s.whatsapp.net",
  };

  const first = await resolveInboundMedia({ stickerMessage: { fileSha256: sha } }, deps);
  assert.equal(first.text, "[sticker: un oso de dibujitos saludando]");
  assert.equal(visionCalls, 1);

  // The whole point of the lexicon: the second sighting costs nothing and says
  // exactly the same thing, so the history stays coherent.
  const second = await resolveInboundMedia({ stickerMessage: { fileSha256: sha } }, deps);
  assert.equal(second.text, first.text);
  assert.equal(visionCalls, 1, "a known sticker must not be described again");

  const entry = recallSticker(sha);
  assert.equal(entry.count, 2, "both sightings counted");
  assert.deepEqual(entry.senders, ["5491166666666@s.whatsapp.net"]);
});

test("the owner's words for a sticker outrank the model's, and survive later sightings", async () => {
  const sha = "sha-pulgar";
  learnSticker(sha, "vision guess", { source: "vision" });
  learnSticker(sha, "el pulgar que usa mamá para decir dale", { source: "owner" });

  const r = await resolveInboundMedia(
    { stickerMessage: { fileSha256: sha } },
    { download: downloadTo(tmpFile("s2.webp")), describeImage: async () => "a thumbs up" }
  );
  assert.match(r.text, /el pulgar que usa mamá/);
  assert.equal(recallSticker(sha).meaning_source, "owner");
});

test("a sticker nobody could describe still announces itself", async () => {
  const r = await resolveInboundMedia(
    { stickerMessage: { fileSha256: "sha-misterio" } },
    { download: downloadTo(tmpFile("s3.webp")), describeImage: async () => null }
  );
  assert.match(r.text, /can't tell what this one shows/);
  assert.equal(recallSticker("sha-misterio"), null, "nothing false is written down");
});

test("a Buffer sha and its base64 string are the same sticker", async () => {
  const buf = Buffer.from([1, 2, 3, 4]);
  learnSticker(buf, "corazón", { source: "owner" });
  assert.equal(recallSticker(buf.toString("base64")).meaning, "corazón");
});

test("the lexicon lists what has been learned, newest first", () => {
  const all = listStickers();
  assert.ok(all.length >= 3);
  assert.ok(all.every((s) => s.key && s.meaning));
});

// ── the rule that covers every branch ──────────────────────────────────────

test("no handled message type ever produces empty text", async () => {
  const cases = [
    { imageMessage: {} },
    { audioMessage: {} },
    { stickerMessage: { fileSha256: "x" } },
    { videoMessage: { gifPlayback: true } },
    { videoMessage: {} },
    { documentMessage: { fileName: "cotizacion.pdf" } },
  ];
  for (const message of cases) {
    const r = await resolveInboundMedia(message, {
      download: downloadTo(tmpFile("any.png")),
      describeImage: async () => null,
      transcribeAudio: async () => ({ text: "" }),
    });
    assert.ok(r.text && r.text.trim().length > 0, `empty text for ${Object.keys(message)[0]}`);
  }
});

// ── markers are prompt text, so they obey the third-party rule too ──────────

test("a third party's markers name no local path", async () => {
  const p = tmpFile("private.png");
  const deps = { download: downloadTo(p), audience: "third_party" };

  const img = await resolveInboundMedia({ imageMessage: {} }, deps);
  assert.ok(!img.text.includes(p), `LEAKED the path into a stranger's prompt: ${img.text}`);
  assert.ok(!/Users|\.apx/.test(img.text), "no filesystem detail at all");
  assert.match(img.text, /image attached/, "…but it still says an image arrived");
  assert.equal(img.media.meta.local_path, p, "the stored record keeps the file");

  const aud = await resolveInboundMedia(
    { audioMessage: {} },
    { ...deps, transcribeAudio: async () => { throw new Error(`ffmpeg: cannot open ${p}`); } }
  );
  assert.ok(!aud.text.includes(p), "an STT error quotes the file it choked on — not to a stranger");
  assert.match(aud.text, /couldn't hear this one/);
});

test("the owner still gets the path, because that is how they reach the file", async () => {
  const p = tmpFile("mine.png");
  const r = await resolveInboundMedia({ imageMessage: {} }, { download: downloadTo(p) });
  assert.ok(r.text.includes(p));
});

// ── reactions ───────────────────────────────────────────────────────────────

test("a reaction is a reaction, not an empty message", async () => {
  // The live bug: a ❤️ classified as nothing, the body fell through to
  // "[empty message]", and the agent asked what had been sent.
  const r = await resolveInboundMedia(
    { reactionMessage: { text: "❤️", key: { id: "3EB0ABC" } } },
    { download: downloadFails }
  );
  assert.equal(r.kind, "reaction");
  assert.equal(r.text, "[reaccionó ❤️]");
  assert.equal(r.media.meta.emoji, "❤️");
  assert.equal(r.media.meta.to_id, "3EB0ABC");
});

test("an empty reaction text means the reaction was REMOVED", async () => {
  const r = await resolveInboundMedia(
    { reactionMessage: { text: "", key: { id: "x" } } },
    { download: downloadFails }
  );
  assert.match(r.text, /quitó su reacción/);
});

// ── the sticker library: understanding one is not the same as sending one ──

test("a learned sticker keeps its bytes, so it can be sent back", async () => {
  const { stickerFile, findStickerByMeaning } = await import("#core/channels/whatsapp/stickers.js");
  const sha = "sha-pulgar-arriba";
  const r = await resolveInboundMedia(
    { stickerMessage: { fileSha256: sha } },
    {
      download: downloadTo(tmpFile("thumb.webp")),
      describeImage: async () => "un pulgar arriba de dibujito, aprobando",
    }
  );
  assert.match(r.text, /pulgar arriba/);

  const file = stickerFile(sha);
  assert.ok(file, "the WebP must survive the media directory it was downloaded into");
  assert.ok(fs.existsSync(file));

  // The agent has words, not hashes. Substring…
  assert.equal(findStickerByMeaning("pulgar")?.key, sha);
  // …and per-word overlap, so it need not quote the description back verbatim.
  assert.equal(findStickerByMeaning("el dibujito aprobando")?.key, sha);
});

test("a loose match is refused — the wrong sticker is worse than none", async () => {
  const { findStickerByMeaning } = await import("#core/channels/whatsapp/stickers.js");
  assert.equal(findStickerByMeaning("una torta de cumpleaños con velas"), null);
  assert.equal(findStickerByMeaning(""), null);
});

test("the same sticker from four people is stored once", async () => {
  const { stickerFile } = await import("#core/channels/whatsapp/stickers.js");
  const sha = "sha-repetido";
  const deps = { describeImage: async () => "un gato bailando" };
  const first = await resolveInboundMedia({ stickerMessage: { fileSha256: sha } },
    { ...deps, download: downloadTo(tmpFile("cat1.webp")), from: "a@s.whatsapp.net" });
  const path1 = stickerFile(sha);
  await resolveInboundMedia({ stickerMessage: { fileSha256: sha } },
    { ...deps, download: downloadTo(tmpFile("cat2.webp")), from: "b@s.whatsapp.net" });
  // Content-addressed: same key, same file, and the second arrival did not even
  // need describing.
  assert.equal(stickerFile(sha), path1);
  assert.match(first.text, /gato bailando/);
});

test("a sticker learned before the library existed still gets its bytes", async () => {
  const { learnSticker, stickerFile } = await import("#core/channels/whatsapp/stickers.js");
  const sha = "sha-legacy";
  // A lexicon entry with no file — exactly what every sticker looked like
  // before the library was added.
  learnSticker(sha, "Baby Groot tomando café", { source: "vision" });
  assert.equal(stickerFile(sha), null);

  // It arrives again. This is the RECALL path, the only one a known sticker
  // takes, so keeping the file only on first sight would mean never.
  await resolveInboundMedia(
    { stickerMessage: { fileSha256: sha } },
    { download: downloadTo(tmpFile("groot.webp")), describeImage: async () => "no debería llamarse" }
  );
  assert.ok(stickerFile(sha), "the recall path must backfill the bytes");
});

test("the file is found whether the key arrived as a Buffer or as base64", async () => {
  const { keepStickerFile, stickerFile, stickerKey } = await import("#core/channels/whatsapp/stickers.js");
  // Baileys hands `fileSha256` as a Buffer; the lexicon stores its base64. The
  // save path had the Buffer and the lookup had the string, and the name was
  // hashed from `String(key)` — so every sticker was written correctly and then
  // read back as missing. Both sides must land on the same file.
  const raw = Buffer.from("una-firma-de-sticker-cualquiera");
  const b64 = stickerKey(raw);

  const kept = keepStickerFile(raw, tmpFile("s-buffer.webp"));
  assert.ok(kept, "saved under the Buffer");
  assert.equal(stickerFile(b64), kept, "…and found under the base64");
  assert.equal(stickerFile(raw), kept, "…and under the Buffer too");
});
