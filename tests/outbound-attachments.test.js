// Attachments in the OTHER direction: what the agent sends.
//
// The inbound half has been right for a while (channel-attachments.test.js).
// The outbound half was broken in four independent places at once, and each one
// on its own was enough to make "the agent shared a photo" render as text:
//
//   1. the Telegram plugin logged the row with `type: "photo"` — not one of the
//      five values the ledger's type enum allows, so it was silently rewritten
//      to "agent" — and with no file named in meta at all;
//   2. every outbound path pointed at the ORIGINAL file (a skill's image, a
//      generated chart), which lives outside ~/.apx/media and is therefore a
//      path /api/media must refuse;
//   3. attach_media only had its pool and its sink in the routine runner, so on
//      every surface with a person on the other end it answered "no attachable
//      images" for skills whose manifest was in the prompt;
//   4. a conversation file surfaced no media on read, in either direction.
//
// These cover 1, 2 and 4 at the seam. 3 is a wiring fact, asserted on the
// source: the tool's contract is "the runner supplies attachableMedia and
// mediaSink", and what regressed was a caller not supplying them.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-outbound-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { archiveOutboundMedia, outboundMediaMeta, attachmentsMeta, outboundMediaDir } =
  await import("#core/stores/media-archive.js");
const { mediaFromMeta, previewText } = await import("#core/stores/messages.js");
const { shapeConversationMessage } = await import("#core/stores/conversations.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

// A 1x1 PNG — real bytes, so the magic number and the size are honest.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100" +
    "05fe02fea7b5f1d40000000049454e44ae426082",
  "hex",
);

/** A file OUTSIDE the media dir — where an agent's images actually live. */
function elsewhere(name, bytes = PNG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-skill-"));
  const p = path.join(dir, name);
  fs.writeFileSync(p, bytes);
  return p;
}

test("a file the agent sends is archived into the media dir the viewer can read", () => {
  const source = elsewhere("grip.png");
  const archived = archiveOutboundMedia(source, { filename: "grip.png", mime: "image/png" });

  assert.ok(archived, "a readable local file must archive");
  // The whole point: the recorded path is inside ~/.apx/media, because that is
  // the only place /api/media will serve from. Naming the skill's own file is
  // what made a delivered image read "attachment failed".
  const root = fs.realpathSync(path.join(process.env.APX_HOME, "media"));
  assert.ok(
    fs.realpathSync(archived.local_path).startsWith(root + path.sep),
    `archived to ${archived.local_path}, which is outside ${root}`,
  );
  assert.equal(fs.readFileSync(archived.local_path).length, PNG.length);
  assert.equal(archived.file_name, "grip.png");
  assert.equal(archived.mime_type, "image/png");
  assert.equal(archived.file_size, PNG.length);
});

test("the same image attached twice is one file on disk", () => {
  // A skill's diagram goes out on every run of a routine. Copying per send
  // would grow the media dir without bound for bytes that never change.
  const a = archiveOutboundMedia(elsewhere("same-a.png"), { mime: "image/png" });
  const b = archiveOutboundMedia(elsewhere("same-b.png"), { mime: "image/png" });
  assert.equal(a.local_path, b.local_path, "identical bytes must land on one path");
  const files = fs.readdirSync(outboundMediaDir()).filter((f) => f.endsWith(".png"));
  assert.equal(new Set(files).size, files.length);
});

test("a Buffer with no path of its own is archived and named", () => {
  // browser_screenshot → send_telegram(photo_base64): there is no file anywhere
  // until this writes one, so without it the row could never name a file.
  const archived = archiveOutboundMedia(PNG, { filename: "captura.png", mime: "image/png" });
  assert.ok(archived);
  assert.equal(archived.file_name, "captura.png");
  assert.ok(fs.existsSync(archived.local_path));
});

test("a URL archives to nothing rather than to a lie", () => {
  // Telegram fetched it; we never held the bytes. Recording a path we do not
  // have would give the viewer a card with nothing behind it.
  assert.equal(archiveOutboundMedia("https://example.com/x.png", { mime: "image/png" }), null);
  assert.equal(archiveOutboundMedia("/does/not/exist.png"), null);
});

test("a file already inside the media dir is pointed at, not copied again", () => {
  const dir = path.join(process.env.APX_HOME, "media", "web");
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "uploaded.png");
  fs.writeFileSync(p, PNG);
  const archived = archiveOutboundMedia(p, { mime: "image/png" });
  assert.equal(archived.local_path, fs.realpathSync(p));
});

test("outbound meta round-trips through mediaFromMeta", () => {
  // The two halves have to agree on field names or the row is written in a
  // spelling the reader does not know — which is exactly how an outbound photo
  // ended up recorded and invisible at the same time.
  const archived = archiveOutboundMedia(elsewhere("nota.oga", Buffer.from("OggS-ish")), {
    mime: "audio/ogg",
  });
  const meta = outboundMediaMeta("audio", archived, { duration: 12 });
  const read = mediaFromMeta(meta);
  assert.equal(read.kind, "audio");
  assert.equal(read.path, archived.local_path);
  assert.equal(read.duration, 12);
  assert.equal(read.mime, "audio/ogg");
});

test("nothing to archive records nothing — no half-written attachment", () => {
  assert.deepEqual(outboundMediaMeta("photo", null), {});
  assert.deepEqual(attachmentsMeta([]), {});
  assert.deepEqual(attachmentsMeta([{ path: "/nope/gone.png" }]), {});
});

test("several attachments keep the list AND mirror the first one flat", () => {
  const meta = attachmentsMeta([
    { path: elsewhere("one.png", Buffer.from("one")), file: "one.png", mime: "image/png", caption: "el grip" },
    { path: elsewhere("two.png", Buffer.from("two")), file: "two.png", mime: "image/png" },
  ]);
  assert.equal(meta.media.length, 2);
  assert.equal(meta.media[0].caption, "el grip");
  // A reader that only understands one attachment still sees one.
  assert.equal(meta.local_path, meta.media[0].path);
  assert.equal(mediaFromMeta(meta).kind, "photo");
});

test("a conversation file surfaces the file in both directions", () => {
  const archived = archiveOutboundMedia(elsewhere("swing.png", Buffer.from("swing")), {
    mime: "image/png",
  });
  // The user's upload: the stored text is the marker the agent was handed, so
  // without media on the row the thread showed "[image attached — saved to …]".
  const asked = shapeConversationMessage({
    role: "user",
    content: "[image attached — saved to /x.png] mirá esto",
    ts: "2026-08-30T10:00:00Z",
    meta: outboundMediaMeta("photo", archived),
  });
  assert.equal(asked.media?.kind, "photo");
  assert.equal(asked.media.path, archived.local_path);

  // The agent's answer, with the image it attached — and its attribution
  // intact, which the same shaping step is responsible for.
  const answered = shapeConversationMessage({
    role: "assistant",
    content: "acá va",
    ts: "2026-08-30T10:00:05Z",
    meta: { agent: "golf-coach", model: "gemini", ...attachmentsMeta([{ path: archived.local_path, file: "swing.png", mime: "image/png" }]) },
  });
  assert.equal(answered.media?.path, archived.local_path);
  assert.equal(answered.media_list?.length, 1);
  assert.equal(answered.agent, "golf-coach", "media must not cost the row its attribution");
});

test("the Telegram plugin logs sent media as a valid type, with the file on it", () => {
  const src = readSrc("host", "daemon", "plugins", "telegram", "index.js");
  // The four senders go through one logger; that logger archives and records.
  assert.match(src, /function logSentMedia\(/);
  assert.match(src, /outboundMediaMeta\(kind, archived/);
  for (const kind of ['kind: "photo"', 'kind: "audio"', 'kind: "document"']) {
    assert.ok(src.includes(kind), `logSentMedia must be called with ${kind}`);
  }
  // The regression itself: `type` is the ledger's enum, never the media kind.
  // `type: "photo"` was accepted by nobody and rejected by nobody either — it
  // just quietly became "agent" with no file attached.
  for (const bad of ['type: "photo"', 'type: "voice"', 'type: "document"', 'type: "audio"']) {
    assert.ok(!src.includes(bad), `${bad} is not a ledger message type`);
  }
});

test("a chat turn gives attach_media its pool and its sink", () => {
  // The tool is only as good as what the runner hands it: an empty pool is an
  // "I have no images" answer for an agent whose images are in its prompt.
  const src = readSrc("core", "agent", "run-turn.js");
  assert.match(src, /collectAgentSkillMedia\(loadAgentSkills\(p, agent\)\)/);
  assert.match(src, /attachableMedia,\s*\n\s*mediaSink,/);
  assert.match(src, /media: mediaSink,/, "the caller has to be able to deliver what was queued");
});

test("the bubble renders an attachment from either side", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "interfaces", "web", "src", "components", "chat", "MessageBubble.tsx"),
    "utf8",
  );
  // `mine ? msg.media : undefined` threw away every file the agent sent, no
  // matter how correctly the row recorded it.
  assert.ok(!/const media = mine \? msg\.media : undefined/.test(src));
  assert.match(src, /const media = msg\.media;/);
});

test("a list preview describes the file instead of printing its marker", () => {
  // The chat list, the inbox row and a notification all stand in for a thread
  // with one line. A turn that carried a file has machine-facing text there:
  // "[photo]" outbound, "[image attached — saved to /Users/…]" inbound. The
  // list printed it raw, so a photo showed up in the sidebar as a file path.
  assert.equal(previewText("[photo]", { kind: "photo", name: "grip.jpg" }), "📷 grip.jpg");
  assert.equal(
    previewText("[image attached — saved to /Users/x.jpg] mirá esto", { kind: "photo", name: "x.jpg" }),
    "📷 mirá esto",
    "a caption is worth more than the file name",
  );
  assert.equal(previewText("[voice]", { kind: "audio", name: "nota.oga" }), "🎤 nota.oga");
  // A row with no file keeps its own text, brackets and all — a message that
  // happens to start with one is not an attachment.
  assert.equal(previewText("[no es media]", null), "[no es media]");
  assert.equal(previewText("  hola   che ", null), "hola che");
});
