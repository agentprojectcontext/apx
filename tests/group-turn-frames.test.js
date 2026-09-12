// A group room streams to every surface, not only to the tab that pressed send.
//
// A cascade is the longest-running turn shape the daemon has: one owner line
// fans out into up to ten agents, each with a full tool loop. For a long time
// it broadcast its LIFECYCLE and nothing else — start, final — because the
// frames had no way to say which speaker they belonged to, and everything a
// follower received merged into the single trailing bubble it paints.
//
// The cost was the room going dark for everyone who was not the sender: a
// second tab, the phone, or that same tab after a refresh showed one empty
// bubble for minutes and then nothing, while the replies piled up on the
// thread. You heard the notifications, you did not see the messages, and a
// manual reload was the only way to read your own room.
//
// So the frames name their speaker and the client starts a new bubble when it
// changes. This file pins that contract on both sides.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

test("a group cascade broadcasts its whole lifecycle", () => {
  const src = read("src/host/daemon/api/groups.js");
  assert.match(src, /import \{ broadcastTurn \}/, "the room must reach the shared feed");
  assert.match(src, /turnFrame\("start"\)/, "…when it begins");
  assert.match(src, /turnFrame\(stopped \? "aborted" : "final"/, "…when it ends, and which ending");
  assert.match(src, /turnFrame\(stopped \? "aborted" : "error"/, "…including the one that threw");
});

test("a group cascade streams its steps, speaker by speaker", () => {
  const src = read("src/host/daemon/api/groups.js");
  assert.match(src, /turnFrame\("delta", \{ agent_slug: speakerSlug, speaker/, "tokens as they are written");
  assert.match(src, /turnFrame\("event", \{ agent_slug: speakerSlug, speaker/, "and the work a token cannot say");
  // Every step frame carries the speaker it belongs to. Without it the client
  // cannot tell one agent's answer from the next and they fuse into one bubble
  // — which is exactly why these frames did not exist before.
  assert.match(src, /speaker = `\$\{ev\.slug\}#\$\{speakerSeq\}`/, "unique per speaker, even on a second turn");
  assert.match(src, /turnFrame\("start", \{ agent_slug: ev\.slug, speaker/, "a speaker takes the floor out loud");
});

test("a speaker that never streamed a token still fills its bubble", () => {
  // THE EMPTY BOXES. Tokens are not guaranteed: a first-choice engine that 429s
  // falls down the chain, and the one that finally answers may not stream at
  // all — a whole cascade then runs without a single `speaker_delta`. The reply
  // was only in the ledger, so every bubble in the room stayed blank under
  // "escribiendo…" until the re-read at the very end of the turn.
  const run = read("src/core/agent/group/run-group-turn.js");
  assert.match(run, /type: "speaker_final", slug, text: reply/, "the reply rides on the closing event");
  const src = read("src/host/daemon/api/groups.js");
  assert.match(src, /event: \{ type: "final", result: \{ text: ev\.text/, "…and reaches followers as a step");
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  // The 1:1 reducer, so the text lands exactly once whether it streamed or not.
  assert.match(hook, /applyStreamEvent\(m, \{ type: "final", result: \{ text: ev\.text, usage: ev\.usage \} \}/);
});

test("the catch-up snapshot follows the floor instead of accumulating", () => {
  const src = read("src/host/daemon/api/groups.js");
  // One record, ten turns: re-opening the room mid-cascade must show the
  // speaker in flight, not everyone who has spoken fused into one bubble
  // beside the same replies already loaded from the thread.
  assert.match(src, /startActiveTurnSpeaker\(active\.id, \{ agent_slug: ev\.slug \}\)/);
  assert.match(src, /recordActiveTurnEvent\(active\.id, ev\)/);
  const turns = read("src/host/daemon/active-turns.js");
  const reset = turns.slice(turns.indexOf("export function startActiveTurnSpeaker"));
  assert.match(reset, /rec\.parts = \[\]/, "the previous speaker's steps do not carry over");
  assert.match(reset, /rec\.text = ""/);
});

test("the client starts a new bubble when the speaker changes", () => {
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  assert.match(hook, /if \(f\.speaker !== undefined && f\.speaker !== liveSpeakerRef\.current\)/);
  assert.match(hook, /if \(liveSpeakerRef\.current\) settleLiveBubble\(\)/, "the one that was talking is finished");
  // Clearing the held turn is what makes patchLive PUSH instead of replace.
  const split = hook.slice(hook.indexOf("if (f.speaker !== undefined"));
  assert.match(split.slice(0, 400), /liveTurnRef\.current = null/);
});

test("a followed room re-reads itself when the turn closes", () => {
  // The room's answer is not on the closing frame — it is several speakers'
  // turns on the thread, with their tools, their model and who pulled each of
  // them in. A follower that only closed its bubble kept what it had painted
  // and never saw the rows they became.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  assert.match(hook, /if \(roomTurn && f\.channel && f\.thread_id\)/);
  assert.match(hook, /loadThreadRef\.current\?\.\(channel, threadId, \{ silent: true \}\)/);
});

test("a room's closing frame does not re-post the last speaker", () => {
  // Its bubbles are not its turn: each speaker closed its own as it finished,
  // and the frame carries no result. The 1:1 close had nothing open to land in
  // and appended the held bubble a second time — the last reply showed twice
  // until the re-read tidied it.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  assert.match(hook, /roomTurn && \(f\.phase === "final" \|\| f\.phase === "aborted"\)/);
  const branch = hook.slice(hook.indexOf('roomTurn && (f.phase === "final"'));
  assert.match(branch.slice(0, 900), /settleLiveBubble\(\);\s*\n\s*done\(\);/);
  // And a room that BROKE says why in a notice rather than on someone's reply.
  assert.match(hook, /roomTurn && f\.phase === "error"/);
});

test("the room's ending is the phase the panel already knows", () => {
  // The frames are only worth sending if `chat-activity.ts` classifies them —
  // the same coupling that broke for `event`. `final` and `aborted` are its
  // unread-raising endings, so a cascade that finishes while you are elsewhere
  // leaves the blue dot the 1:1 chats leave.
  const activity = read("src/interfaces/web/src/lib/chat-activity.ts");
  assert.match(activity, /frame\.phase === "final" \|\| frame\.phase === "aborted"/);
});

test("a turn that closes with nothing in it leaves no bubble", () => {
  // The group's `final` carries no result — the room's answer is the speakers'
  // own turns, already on the thread. Without this the follower would be left
  // with a blank assistant bubble at the foot of the room until the silent
  // re-read replaced it.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  const close = hook.slice(hook.indexOf("const closeLive"), hook.indexOf("const onTurnFrame"));
  assert.match(close, /const empty = !closed\.parts\.length && !closed\.media\?\.length/);
  assert.match(close, /if \(empty\) copy\.pop\(\)/);
});

test("an open room hears its own writes on the message feed", () => {
  // The belt to the frames' braces, and the only thing that covers a follower
  // whose socket was down for part of the cascade. A project ledger holds every
  // room in one day file, so the day cannot say which one moved: the write
  // announces `thread_id` and the panel matches on it. Before this, the test
  // below was `scope === "global"` — false for every row a room has ever
  // written.
  const live = read("src/interfaces/web/src/lib/live.ts");
  assert.match(live, /if \(ev\.thread_id\) return ev\.thread_id === threadId/);
  const ws = read("src/host/daemon/events-ws.js");
  assert.match(ws, /thread_id: event\.thread_id \|\| null/, "and it has to survive the fan-out");
  assert.match(ws, /e\.thread,\s*e\.thread_id/, "two rooms in one window are two events, not one");
});

test("a line written while the room is answering is not thrown away", () => {
  // It used to be a bare `return`: the composer cleared and the message stopped
  // existing — no bubble, no queue, no error — and a cascade is minutes long,
  // so the window to lose one is wide. It parks like a 1:1 turn now, and goes
  // back into the ROOM rather than out as a web turn.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  const sendGroup = hook.slice(hook.indexOf("const sendGroup = useCallback"));
  assert.match(sendGroup.slice(0, 2000), /if \(streamingRef\.current \|\| followingRef\.current\) \{/);
  assert.match(sendGroup.slice(0, 2000), /opts: \{ group_id: gid/);
  assert.match(hook, /const gid = next\.opts\?\.group_id;/, "and the drain knows where it belongs");
});

test("Stop reaches a room caught up on after a refresh", () => {
  // `{ channel }` alone resolves to the super-agent's key, so the daemon
  // answered "nothing to stop" and the local socket it fell back to did not
  // exist in a tab that was only following.
  const hook = read("src/interfaces/web/src/hooks/useChat.ts");
  assert.match(hook, /turnTargetRef\.current = isRoomChannel\(channel\)\s*\?\s*\{ channel, thread_id: threadId \}/);
});
