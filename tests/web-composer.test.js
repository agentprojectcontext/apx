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

test("a message typed mid-run is sent, not a reason to stop the run", () => {
  const input = web("components", "ui", "chat-input.tsx");
  // The button under a working agent used to be "stop" and nothing else, so
  // the only way to add a sentence to the conversation was to kill the answer
  // being written. Stop is now what the button becomes when the field is EMPTY.
  assert.match(input, /\{busy && onStop && !canSend \? \(/, "a draft in the field outranks stop");
  assert.doesNotMatch(input, /const canSend = [^\n]*busy/, "what can be sent does not depend on the run");
  // …and the same on the keyboard: Enter mid-run sends, it does not no-op.
  const keydown = input.slice(input.indexOf("onKeyDown="), input.indexOf("className=\"w-full resize-none"));
  assert.match(keydown, /if \(!canSend\) return/);
  assert.doesNotMatch(keydown, /busy/, "Enter is not gated on the run either");

  // Composing is not gated on it either: "look at this" needs the this.
  const composer = web("components", "chat", "Composer.tsx");
  assert.doesNotMatch(composer, /disabled=\{streaming \|\| full\}/, "the attach menu and the mic stay live mid-run");
});

test("a queued turn waits its turn without touching the one in flight", () => {
  const chat = web("hooks", "useChat.ts");
  // Queued turns are their own state. Everything that paints a live answer
  // (patchLast, and the two error paths) addresses the LAST message, so a
  // queued bubble parked at the end of `msgs` would take the rest of the
  // stream — or be the thing a failed turn deleted.
  assert.match(chat, /const \[queued, setQueued\] = useState<QueuedTurn\[\]>\(\[\]\)/);
  assert.match(chat, /if \(streaming\) \{\s*\n\s*setQueued\(\(curr\) => \[\.\.\.curr,/, "a send during a run queues instead of being dropped");
  assert.doesNotMatch(chat, /\(!trimmed && !files\.length\) \|\| streaming/, "streaming is no longer a refusal");

  // The drain is an EFFECT, not `send`'s own finally: `send` builds history
  // from the msgs its closure captured, which is the list from BEFORE the turn
  // that just finished — a queued message sent from in there would reach an
  // agent with no record of the answer it is replying to.
  const drain = chat.slice(chat.indexOf("const unqueue ="), chat.indexOf("const clear ="));
  assert.match(drain, /useEffect\(\(\) => \{[\s\S]*if \(streaming \|\| queued\.length === 0\) return;/);
  assert.match(drain, /const \[next, \.\.\.rest\] = queued;[\s\S]*void send\(next\.text, next\.opts\)/, "one at a time, in order");
  const sendBody = chat.slice(chat.indexOf("const send = useCallback"), chat.indexOf("const stop = useCallback"));
  assert.doesNotMatch(sendBody, /setQueued\(rest\)/, "nothing drains from inside the turn it is waiting on");

  // Stop ends the turn being written; it does not cancel what you queued —
  // "wrong direction, here is what I meant" is send-then-stop, and the
  // correction has to survive the stop.
  const stopBody = chat.slice(chat.indexOf("const stop = useCallback"), chat.indexOf("const unqueue ="));
  assert.doesNotMatch(stopBody, /setQueued/);
  // Leaving the thread does drop it; a background catch-up of the same thread
  // must not.
  assert.match(chat, /if \(!opts\?\.silent\) \{ setMsgs\(\[\]\); setQueued\(\[\]\); \}/);
});

test("a queued turn is in the thread, and can be taken back", () => {
  const list = web("components", "chat", "MessageList.tsx");
  const bubble = web("components", "chat", "MessageBubble.tsx");
  // It is in the conversation the moment you send it — same bubble, drawn at
  // the foot of the thread where it will land.
  assert.match(list, /\{queued\.map\(\(q\) => \(\s*\n\s*<MessageBubble/);
  assert.match(list, /queued\n\s*onUnqueue=/);
  assert.match(list, /\}, \[msgs, queued, autoscroll\]\)/, "and it scrolls into view like any other turn");
  assert.match(bubble, /queued && "opacity-55"/, "half strength: it has not gone out yet");
  // A timestamp on a turn that has not been sent is a receipt for something
  // that did not happen. And the way out is not hidden behind a hover.
  assert.match(bubble, /queued \? \(\s*\n\s*<span className="inline-flex items-center gap-1">\s*\n\s*<Clock size=\{10\} \/> \{t\("chat_ui\.queued"\)\}/);
  assert.match(bubble, /!compact && !queued && "opacity-0 transition-opacity group-hover:opacity-100"/);
  assert.match(bubble, /aria-label=\{t\("chat_ui\.queued_cancel"\)\}/);

  for (const lang of ["en", "es"]) {
    const dict = web("i18n", `${lang}.ts`);
    assert.match(dict, /queued:\s+"/, `${lang} names the state`);
    assert.match(dict, /queued_cancel:\s+"/, `${lang} names the way out`);
  }
});
