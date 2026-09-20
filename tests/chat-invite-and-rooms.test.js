// The panel side of "invite somebody and stay in the conversation".
//
// Three decisions live in ChatTab and one in the phone's routing, and all four
// were wrong in the same direction: they treated the chat you are in as
// disposable. Inviting opened a new empty room; typing into an a2a pane sent
// the line somewhere else entirely; a pair rendered as a 1:1, so two agents
// answering each other were told apart only by a chip under the bubble; and a
// super-agent row always claimed project 0.
//
// Source assertions rather than a rendered component: these are decisions, and
// what has to hold is which call the screen makes, not what it looks like.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatInProjectUrl } from "../src/interfaces/web/src/screens/mobile/routes.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const chatTab = () => read("src/interfaces/web/src/screens/project/ChatTab.tsx");

test("inviting somebody into a 1:1 converts THAT chat", () => {
  const src = chatTab();
  // `from` is what makes it a conversion instead of a second room: the daemon
  // replays the transcript onto the new room and archives the file.
  assert.match(src, /\{ agent: selected\.agentSlug, conversation: selected\.convId \}/);
  assert.match(src, /participants: \[base, slug\],\s*\.\.\.\(from \? \{ from \} : \{\}\),/);
});

test("speaking in an a2a pair converts it into a room instead of leaking to another channel", () => {
  const src = chatTab();
  assert.match(src, /const promoteA2A = async \(slug\?: string\)/);
  assert.match(src, /from: \{ thread: selected\.threadId \}/);
  // …and the line that triggered it is sent INTO the room, not dropped.
  assert.match(src, /if \(isA2A && selected\.kind === "thread"\) \{\n\s*const gid = await promoteA2A\(\);/);
  assert.match(src, /await groupSend\(gid, text, media, opts\);/);
  // The branch has to come before the generic super-agent send, or the message
  // still goes out on the web channel.
  assert.ok(
    src.indexOf("const gid = await promoteA2A();") < src.indexOf("if (activeIsRoby) {"),
    "the a2a branch must be reached before the super-agent fallback",
  );
});

test("a pair offers the same invite a room does", () => {
  const src = chatTab();
  assert.match(src, /const canAddPeople = isGroup \|\| isA2A \|\|/);
  assert.match(src, /isGroup \? addToGroup\(slug\) : isA2A \? promoteA2A\(slug\) : escalateToGroup\(slug\)/);
});

test("a pair is drawn as a room: the speaker above the bubble", () => {
  // "Los agent to agent para mí son grupo … debería tener el diseño de grupo
  // que muestra el usuario arriba y la cita abajo" — Manu, 2026-09-20. Under
  // the 1:1 layout the speaker went into the footer chip, which is the one
  // place that cannot tell two agents apart at a glance.
  assert.match(chatTab(), /showSpeaker=\{isMultiThread\}/);
  const bubble = read("src/interfaces/web/src/components/chat/MessageBubble.tsx");
  assert.match(bubble, /showSpeaker && !mine/, "the header above the bubble is what showSpeaker draws");
  assert.match(bubble, /!mine && msg\.agent && !showSpeaker/, "…and it replaces the footer chip, never doubles it");
});

test("a super-agent row opens in the project its chat lives in", () => {
  const row = {
    kind: "super_agent", project_id: "4", agent_slug: "roby",
    channel: "web", conversation_id: "2026-09-20",
  };
  assert.equal(chatInProjectUrl(row), "/p/4/chat?channel=web&thread=2026-09-20");
  // A channel with no project of its own still lands in the default workspace,
  // which is where it always landed.
  assert.equal(
    chatInProjectUrl({ ...row, project_id: null, channel: "telegram" }),
    "/p/0/chat?channel=telegram&thread=2026-09-20",
  );
});
