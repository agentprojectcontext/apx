// The composer: what a turn can carry, and how it behaves on a phone.
//
// These are source contracts, not rendering tests — the point is that the
// pieces which are easy to regress silently stay put: several files per turn
// (the daemon has always accepted an array), a recording stored as audio rather
// than as a video with no picture, and text that cannot push a bubble off the
// side of a phone.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const web = (...p) => fs.readFileSync(path.join(__dirname, "..", "src", "interfaces", "web", "src", ...p), "utf8");

test("a turn carries several files, not one", () => {
  const composer = web("components", "chat", "Composer.tsx");
  assert.match(composer, /onSend: \(text: string, media\?: UploadedMedia\[\]\)/, "the composer hands over a list");
  assert.match(composer, /pending, setPending\] = useState<Pending\[\]>/);

  const chat = web("hooks", "useChat.ts");
  assert.match(chat, /media\?: MessageMedia\[\]/, "the sent turn shows every file it carried");
  // Anything still uploading when Enter is pressed is awaited, never dropped —
  // the caption arriving without its photo is worse than a moment's wait.
  assert.match(composer, /media\.push\(await job\)/);

  const tab = web("screens", "project", "ChatTab.tsx");
  assert.match(tab, /media\?\.length \? \{ attachments: media \}/, "all of them reach the daemon");
});

test("a browser recording is stored as audio", () => {
  const rec = web("hooks", "useRecorder.ts");
  // Chromium records Opus in WebM, Safari records AAC in MP4. Both need an
  // extension the daemon maps to an audio/* type: ".webm" is video/webm, which
  // would render the voice note as a player with no picture.
  assert.match(rec, /"audio\/webm;codecs=opus", ext: "\.weba"/);
  assert.match(rec, /"audio\/mp4", ext: "\.m4a"/);
  // getUserMedia is gated on a secure context, so the panel served over plain
  // http:// on a LAN address has no microphone at all. Say so rather than
  // failing with an empty recorder.
  assert.match(rec, /export function canRecord/);
  assert.match(rec, /rec_insecure/);
});

test("a voice note reaches the model as words", () => {
  const composer = web("components", "chat", "Composer.tsx");
  // A model cannot listen to a file: the audio is attached (so the bubble plays
  // it back) and the transcript goes in the field, editable before sending.
  assert.match(composer, /transcribeAudio\(out\.file\)/);
  assert.match(composer, /attach\(\[out\.file\], \{ seconds: out\.seconds \}\)/);
});

test("a pasted URL cannot push a bubble off the screen", () => {
  const bubble = web("components", "chat", "MessageBubble.tsx");
  // `break-words` (overflow-wrap: break-word) wraps the glyphs but still
  // reports the whole unbroken string as the element's MIN-CONTENT width, so
  // any ancestor that sizes to content is laid out around it and the overflow
  // returns. Only `anywhere` shrinks that intrinsic width.
  assert.match(bubble, /\[overflow-wrap:anywhere\]/);
  assert.doesNotMatch(bubble, /whitespace-pre-wrap break-words/);
  assert.match(bubble, /max-w-\[85%\]/, "the column is capped");
  assert.match(bubble, /min-w-0/, "and allowed to shrink below its content");
});

test("the composer cannot grow over the conversation it is about", () => {
  const input = web("components", "ui", "chat-input.tsx");
  // Two ceilings, lower wins: maxRows shapes the field, and a share of the
  // window keeps a long draft from swallowing a 812px phone screen.
  assert.match(input, /Math\.min\(lineHeight \* maxRows, Math\.round\(window\.innerHeight \* 0\.4\)\)/);
  assert.match(input, /window\.addEventListener\("resize", resize\)/, "rotating the phone moves that ceiling");
});

test("picking a file uploads it once, not once per render pass", () => {
  const composer = web("components", "chat", "Composer.tsx");
  // React may call a state updater more than once for a single update, and in
  // StrictMode it always does — so an upload started inside `setPending` ran
  // twice per file and left an orphan copy in ~/.apx/media each time. The
  // updater has to stay pure, which means the room check cannot read
  // `curr.length` either.
  const attach = composer.slice(composer.indexOf("const attach ="), composer.indexOf("// ── Voice notes"));
  assert.ok(
    attach.indexOf("uploadMedia(file)") < attach.indexOf("setPending((curr) => [...curr, ...added])"),
    "the upload starts before the state update, not inside it",
  );
  assert.match(attach, /MAX_ATTACHMENTS - countRef\.current/, "the room check reads a ref, not the pending state");
  assert.doesNotMatch(attach, /setPending\(\(curr\) => \{[\s\S]*uploadMedia/, "no side effect inside an updater");
});
