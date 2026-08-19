// Attachments that arrive over a channel: what the viewer gets back.
//
// A voice note or a file used to reach the web thread as the marker the AGENT
// was handed — "[document received: mapa.pdf, 27 KB … saved to /Users/…]" —
// which tells the person who sent it nothing. The bytes were on disk the whole
// time (~/.apx/media) and the turn recorded where; the reader just dropped the
// metadata. These cover the read side of that contract.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { readGlobalThread, mediaFromMeta } = await import("#core/stores/messages.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", ...p), "utf8");

/** A one-day telegram ledger in a temp dir, shaped like the real store. */
function ledger(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-attach-"));
  fs.mkdirSync(path.join(dir, "telegram"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "telegram", "2026-08-18.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  return dir;
}

const userRow = (body, meta) => ({
  ts: "2026-08-18T17:14:03Z",
  channel: "telegram",
  direction: "in",
  type: "user",
  author: "@manu",
  actor_id: "7",
  body,
  meta: { chat_id: 42, message_id: 1, type: "user", ...meta },
});

test("a voice note comes back as the file, not just its transcript", () => {
  const dir = ledger([
    userRow("[audio] dale, mandámelo", {
      media_kind: "audio",
      local_path: "/Users/x/.apx/media/tg_abc.oga",
      file_id: "f1",
      duration: 71,
      mime_type: "audio/ogg",
      transcription_backend: "local",
    }),
  ]);
  const thread = readGlobalThread({ channel: "telegram", date: "2026-08-18", _globalMessagesDir: dir });
  const [m] = thread.messages;
  assert.equal(m.role, "user");
  assert.equal(m.media.kind, "audio");
  assert.equal(m.media.duration, 71);
  assert.equal(m.media.path, "/Users/x/.apx/media/tg_abc.oga");
  assert.equal(m.media.name, "tg_abc.oga", "no file_name on a voice note — the stored file names it");
  // The transcript still rides along: it is what the agent answered.
  assert.match(m.content, /dale, mandámelo/);
});

test("a document keeps the name and size the sender saw", () => {
  const dir = ledger([
    userRow("[document received: mapa.pdf, 27 KB, application/pdf — saved to /Users/x/.apx/media/mapa-9.pdf.]", {
      media_kind: "document",
      local_path: "/Users/x/.apx/media/mapa-9.pdf",
      file_id: "f2",
      file_name: "mapa.pdf",
      mime_type: "application/pdf",
      file_size: 27405,
    }),
  ]);
  const [m] = readGlobalThread({ channel: "telegram", date: "2026-08-18", _globalMessagesDir: dir }).messages;
  assert.equal(m.media.kind, "document");
  assert.equal(m.media.name, "mapa.pdf");
  assert.equal(m.media.size, 27405);
});

test("a download that failed says so instead of offering a dead player", () => {
  const dir = ledger([
    userRow("[video received: … the download FAILED …]", {
      media_kind: "video",
      local_path: null,
      file_id: "f3",
      file_size: 90_000_000,
    }),
  ]);
  const [m] = readGlobalThread({ channel: "telegram", date: "2026-08-18", _globalMessagesDir: dir }).messages;
  assert.equal(m.media.kind, "video");
  assert.equal(m.media.path, null, "no local copy — the viewer must not pretend otherwise");
});

test("history written before media_kind existed still resolves", () => {
  // Rows from before dispatch merged the media record: no media_kind, so the
  // kind is inferred from what IS there. Every attachment in the user's own
  // ledger predates the field.
  assert.equal(mediaFromMeta({ file_id: "a", duration: 12, transcription_backend: null }).kind, "audio");
  assert.equal(mediaFromMeta({ file_id: "b", width: 1280, height: 720 }).kind, "photo");
  assert.equal(mediaFromMeta({ file_id: "c", file_name: "x.pdf" }).kind, "file");
  assert.equal(mediaFromMeta({ chat_id: 1 }), null, "a plain typed message has no attachment");
  assert.equal(mediaFromMeta(undefined), null);
});

test("a plain message carries no media field at all", () => {
  const dir = ledger([userRow("hola", {})]);
  const [m] = readGlobalThread({ channel: "telegram", date: "2026-08-18", _globalMessagesDir: dir }).messages;
  assert.equal("media" in m, false);
});

test("the media endpoint is sandboxed to ~/.apx/media", () => {
  const src = readSrc("host", "daemon", "api", "media.js");
  assert.match(src, /realpathSync/, "symlinks must be resolved on both sides before the prefix check");
  assert.match(src, /startsWith\(realRoot \+ path\.sep\)/, "a path outside the media dir must be refused");
  assert.doesNotMatch(src, /req\.query\.mime/, "the content type must come from the extension, never the request");
  assert.match(src, /X-Content-Type-Options/, "nosniff, so a stray file cannot render as HTML");
});

// A turn can now carry SEVERAL files (the web composer sends up to ten, and
// the daemon has always accepted an array), so the bubble renders a group and
// strips one marker per file rather than exactly one. A turn replayed from the
// ledger still has a single file — that side of the store holds one media block
// per row — and arrives here as a list of one.
test("the bubble shows the files and drops the marker text", () => {
  const src = readSrc("interfaces", "web", "src", "components", "chat", "MessageBubble.tsx");
  assert.match(src, /<AttachmentGroup media=\{media\} \/>/, "the attachments render above the text");
  assert.match(
    src,
    /stripMediaMarker\(textOf\(msg\), media\.length\)/,
    "copying a media turn copies what is shown, one marker dropped per file",
  );
  assert.match(src, /textOfPart\(part\.text, media\)/, "the machine-facing marker is not shown as the message");
});
