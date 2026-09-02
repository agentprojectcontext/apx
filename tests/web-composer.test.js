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
  const duringRun = chat.slice(chat.indexOf("if (streamingRef.current || followingRef.current)"), chat.indexOf("const history: ConversationMessage[]"));
  assert.match(duringRun, /writeBackgroundQueue\(key, \[/, "a send during a run enters the chat-owned queue");
  assert.doesNotMatch(chat, /\(!trimmed && !files\.length\) \|\| streaming/, "streaming is no longer a refusal");
  // …and by DEFAULT it also cuts the running turn short. Writing while an agent
  // works almost always means "no, stop, do this instead" — which is what a new
  // message has always done on Telegram. It is still queued either way: the
  // drain effect is what sends it, so the message survives the interruption and
  // goes out with a history that includes whatever the stopped turn wrote.
  assert.match(duringRun, /if \(!queueOnSendRef\.current\) void stopTurn\(\)/, "interrupt is the default");

  // The queue belongs to the chat, not the mounted pane. The worker survives a
  // route change and drains from refs that were updated by the finished turn.
  const drain = chat.slice(chat.indexOf("const unqueue ="), chat.indexOf("const clear ="));
  assert.match(chat, /const backgroundQueues = new Map<string, QueuedTurn\[\]>\(\)/);
  assert.match(drain, /takeBackgroundQueue\(key\)/, "one at a time, in order");
  assert.match(drain, /void sendRef\.current\(next\.text, next\.opts\)/);
  assert.match(chat, /queueMicrotask\(\(\) => drainQueueRef\.current\(\)\)/,
    "the request worker drains even after its pane unmounts");
  assert.match(chat, /const history: ConversationMessage\[\] = msgsRef\.current\.map/,
    "the queued turn sees the answer that just landed");

  // Stop ends the turn being written; it does not cancel what you queued —
  // "wrong direction, here is what I meant" is send-then-stop, and the
  // correction has to survive the stop.
  const stopBody = chat.slice(chat.indexOf("const stop = useCallback"), chat.indexOf("const unqueue ="));
  assert.doesNotMatch(stopBody, /setQueued/);

  // Stop has to reach the DAEMON. Closing our socket never stopped the run —
  // that is deliberate, it is what lets another tab catch up on a turn in
  // progress — so the panel's stop button was a button that stopped nothing:
  // the turn kept going, kept calling tools, and persisted its answer to a
  // thread nobody was watching.
  const stopTurnBody = chat.slice(chat.indexOf("const stopTurn = useCallback"), chat.indexOf("const send = useCallback"));
  assert.match(stopTurnBody, /await Turns\.abort\(pid, target\)/, "the run is stopped by asking, not by hanging up");
  assert.match(stopTurnBody, /if \(aborted\) return;/);
  assert.match(stopTurnBody, /abortRef\.current\?\.abort\(\)/, "and the local abort stays as the fallback");
  // The turn names itself before it does any work, so it can be addressed from
  // the first token — `final` used to be the first mention of the conversation
  // it had been writing to all along.
  assert.match(chat, /if \(ev\.type === "start"\)/);
  assert.match(chat, /turnTargetRef\.current = \{ channel: "web" \}/, "Roby's thread IS its channel");
  // Reopening the chat binds to its existing queue; navigation cannot erase it.
  assert.match(chat, /const snapshot = readBackgroundQueue\(key\)/);
  assert.doesNotMatch(chat, /backgroundQueues\.delete\(queueKeyRef\.current/);
});

test("switching chats never leaves the previous transcript or stream in the pane", () => {
  const chat = web("hooks", "useChat.ts");
  // History loads used to return while the previous pane's NDJSON request was
  // active. The sidebar selected B, but B rendered A until that request ended.
  const load = chat.slice(chat.indexOf("const load = useCallback"), chat.indexOf("const loadThread = useCallback"));
  const loadThread = chat.slice(chat.indexOf("const loadThread = useCallback"), chat.indexOf("// A group turn"));
  assert.doesNotMatch(load, /if \(streaming\) return/);
  assert.doesNotMatch(loadThread, /if \(streaming\) return/);
  assert.match(chat, /const viewEpochRef = useRef\(0\)/);
  assert.match(chat, /const beginViewChange = useCallback/);
  assert.match(load, /beginViewChange\(\);\s*\n\s*bindQueue\(activityKey\)/);
  assert.match(loadThread, /beginViewChange\(\);\s*\n\s*bindQueue\(threadActivityKey/);
  // The old HTTP stream may finish after the new history loaded, but its late
  // frames are scoped to the view that launched it rather than patchLast(B).
  assert.match(chat, /const streamViewEpoch = viewEpochRef\.current;/);
  assert.match(chat, /const ownsView = \(\) => viewEpochRef\.current === streamViewEpoch;/);
  assert.match(chat, /if \(!ownsView\(\)\) return;/);
  assert.match(chat, /\(ev\) => \{ if \(ownsView\(\)\) applyEvent\(ev\); \}/);
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

test("interrupt-or-queue is a per-device choice, offered where it applies", () => {
  const composer = web("components", "chat", "Composer.tsx");
  // Only while something is running: what happens if you write right now is the
  // only question it answers, and a switch for a situation you are not in is
  // clutter.
  assert.match(composer, /\{streaming \? <SendModeToggle \/> : null\}/);
  assert.match(composer, /onClick=\{\(\) => setQueueOnSend\(!queues\)\}/);
  assert.match(composer, /aria-pressed=\{queues\}/, "it is a switch, and says so to a screen reader");

  // Per device, like the channel view/notify choices — the phone and the desktop
  // are used differently by the same person.
  const prefs = web("lib", "chat-prefs.ts");
  assert.match(prefs, /localStorage\.getItem\(KEY\) === "1"/);
  assert.match(prefs, /return false;/, "the default is interrupt");
  assert.match(prefs, /catch \{/, "private mode must not make the composer throw");
});

test("every chat rail reuses one running/unread indicator", () => {
  const activity = web("lib", "chat-activity.ts");
  const indicator = web("components", "chat", "ChatRowActivity.tsx");
  const chats = web("components", "chat", "ChatList.tsx");
  const inbox = web("components", "inbox", "InboxRowItem.tsx");

  assert.match(activity, /subscribeTurns\(onTurn\)/, "one device-wide turn feed");
  assert.match(activity, /frame\.phase === "final" \|\| frame\.phase === "aborted"/);
  assert.match(indicator, /LoaderCircle[\s\S]*animate-spin/, "working is a spinner");
  assert.match(indicator, /bg-blue-500/, "finished out of view is a blue dot");
  assert.match(indicator, /transition-\[width,margin,opacity\]/, "activity expands smoothly beside the badge");
  assert.doesNotMatch(indicator, /absolute -right-1 -top-1/, "activity no longer floats in the row corner");
  assert.match(chats, /<ChatRowActivity activityKey=\{activityKey\}/);
  assert.match(inbox, /<ChatRowActivity activityKey=\{activityKey\}/);
});
