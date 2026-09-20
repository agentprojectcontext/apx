// Inviting somebody CONVERTS the chat you are in. It does not open a new one.
//
// What it used to do: "add someone" in a 1:1 called `POST /projects/:pid/groups`
// with two slugs and navigated away. The room that opened was empty — the
// conversation you had been having stayed in the agent's own file, invisible
// from the room, so the agent that had just been pulled in knew nothing about
// what had been said and the first move was always to re-explain it.
//
// Manu, 2026-09-20: "cuando estamos en un chat común e invito a alguien, en vez
// de invitarlo y ya convertir ese chat en grupo, arma otro chat en grupo y eso
// rompe todo. Y los agent to agent para mí son grupo, entonces cuando empiezo a
// hablar deberían convertirse en grupo."
//
// So there are two promotions, and this file pins both: a 1:1 (a markdown file
// under one agent) and an a2a pair (rows on the ledger). Either way the
// transcript is replayed onto the room, at the times things were actually said,
// and the room opens with the conversation already in it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-promote-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { promoteConversationToGroup, promoteA2AThreadToGroup } =
  await import("#core/stores/group-promote.js");
const { startConversation, appendTurn, listConversations, readConversation } =
  await import("#core/stores/conversations.js");
const { appendMessageToFs, readProjectGroupThread, listProjectGroupThreads, a2aThreadId } =
  await import("#core/stores/messages.js");

let n = 0;
function store() {
  const storagePath = path.join(TMP_HOME, `store${++n}`);
  fs.mkdirSync(storagePath, { recursive: true });
  return {
    storagePath,
    logMessage: (payload) => appendMessageToFs({ projectRoot: storagePath, ...payload }),
  };
}

/** A 1:1 with two turns already in it. */
function chatWith(s, slug = "magui") {
  const conv = startConversation({
    storagePath: s.storagePath, agentSlug: slug, engine: "test:model", channel: "web",
  });
  appendTurn({ filePath: conv.path, role: "user", content: "¿Cómo viene el brief de acme?" });
  appendTurn({
    filePath: conv.path, role: "assistant", content: "Lo tengo casi listo.",
    meta: { agent: slug, model: "test:model" },
  });
  return conv;
}

test("a 1:1 becomes the room, carrying what was said in it", () => {
  const s = store();
  const conv = chatWith(s);

  const out = promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    agentSlug: "magui", conversationId: conv.id, participants: ["andy"],
  });

  assert.equal(out.imported, 2, "both turns have to reach the room");
  const room = readProjectGroupThread(s.storagePath, out.id);
  assert.ok(room, "the room exists");
  assert.deepEqual(room.participants.sort(), ["andy", "magui"], "and the agent you were talking to is IN it");

  const said = room.messages.filter((m) => m.role === "user" || m.role === "assistant");
  assert.deepEqual(said.map((m) => m.content), [
    "¿Cómo viene el brief de acme?",
    "Lo tengo casi listo.",
  ], "in order, and it is the SAME conversation — not an empty room beside it");
  assert.equal(said[0].role, "user", "the owner's line stays the owner's");
  assert.equal(said[1].agent, "magui", "and the agent's stays attributed to it");
  assert.equal(said[1].model, "test:model", "attribution survives the move");
});

test("the room is stamped ahead of the history it introduces", () => {
  // `groupRows` orders by timestamp and nothing else, so a creation row dated
  // AFTER the lines it introduces would put the roster in the middle of its own
  // transcript — and the sidebar would date the room to a conversation it had
  // not had yet.
  const s = store();
  const conv = chatWith(s);
  const out = promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    agentSlug: "magui", conversationId: conv.id, participants: ["andy"],
  });
  const [row] = listProjectGroupThreads(s.storagePath);
  assert.equal(row.id, out.id);
  assert.ok(row.started_at <= readProjectGroupThread(s.storagePath, out.id).messages[0].ts);
});

test("the 1:1 is put away, with a pointer to where it went", () => {
  // Two live copies of one conversation is exactly what this avoids. Archived,
  // never deleted: what was said is not ours to throw away.
  const s = store();
  const conv = chatWith(s);
  const out = promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    agentSlug: "magui", conversationId: conv.id, participants: ["andy"],
  });
  assert.equal(
    listConversations(s.storagePath, "magui").length, 0,
    "the promoted chat must stop being offered as a chat to resume",
  );
  const kept = readConversation(s.storagePath, "magui", conv.id);
  assert.ok(kept, "…and must still be on disk");
  assert.equal(kept.fm.promoted_to_group, out.id, "saying where it continues");
});

test("a chat nobody has spoken in yet still opens an ordinary room", () => {
  const s = store();
  const conv = startConversation({
    storagePath: s.storagePath, agentSlug: "magui", engine: "test:model", channel: "web",
  });
  const out = promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    agentSlug: "magui", conversationId: conv.id, participants: ["andy"],
  });
  assert.equal(out.imported, 0);
  assert.deepEqual(readProjectGroupThread(s.storagePath, out.id).participants.sort(), ["andy", "magui"]);
});

test("the agent you were talking to cannot be left out of its own room", () => {
  const s = store();
  const conv = chatWith(s);
  const out = promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    // A caller that lists only the newcomer is corrected, not obeyed: a room
    // holding somebody else's conversation with the one agent that had it
    // missing is not a conversion of anything.
    agentSlug: "magui", conversationId: conv.id, participants: ["andy"],
  });
  assert.ok(readProjectGroupThread(s.storagePath, out.id).participants.includes("magui"));
});

// ── a2a pairs ───────────────────────────────────────────────────────────────

function pairBetween(s, from, to) {
  const ts = (n2) => `2026-09-1${n2}T10:00:00Z`;
  s.logMessage({
    agent_slug: to, channel: "a2a", direction: "in", author: from,
    body: "Necesito el estado de acme.", meta: { from }, ts: ts(1), external_id: "m1",
  });
  s.logMessage({
    agent_slug: to, channel: "a2a", direction: "out", type: "agent", actor_kind: "agent",
    actor_id: to, author: to, body: "Va, lo tengo.", meta: { to: from, final: true, model: "test:model" },
    ts: ts(2), external_id: "m2",
  });
  s.logMessage({
    agent_slug: from, channel: "a2a", direction: "in", author: to,
    body: "Va, lo tengo.", meta: { from: to }, ts: ts(2), external_id: "m2",
  });
  return a2aThreadId(from, to);
}

test("an a2a pair becomes a room the owner is in, carrying the exchange", () => {
  const s = store();
  const thread = pairBetween(s, "andy", "magui");
  const out = promoteA2AThreadToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    threadId: thread, knownAgents: ["andy", "magui", "otro"],
  });
  assert.deepEqual(out.participants.sort(), ["andy", "magui"]);
  const room = readProjectGroupThread(s.storagePath, out.id);
  assert.deepEqual(
    room.messages.map((m) => m.content),
    ["Necesito el estado de acme.", "Va, lo tengo."],
    "the pair's conversation, not an empty room",
  );
  // Every line in a pair is an agent's — there is no owner in an a2a thread,
  // which is precisely why the owner speaking has to convert it.
  assert.ok(room.messages.every((m) => m.role === "assistant"));
  assert.deepEqual(room.messages.map((m) => m.agent), ["andy", "magui"]);
});

test("the super-agent's seat in a pair becomes the owner's", () => {
  // A room is "the owner plus N project agents". The super-agent is not a member
  // of one: in a room the owner speaks for themselves. So `roby~magui` promotes
  // to a room with Magui in it — which is the conversation that was wanted.
  const s = store();
  const thread = pairBetween(s, "super_agent", "magui");
  const out = promoteA2AThreadToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    threadId: thread, knownAgents: ["magui"],
  });
  assert.deepEqual(out.participants, ["magui"]);
  const room = readProjectGroupThread(s.storagePath, out.id);
  assert.equal(room.messages.length, 2, "what the super-agent said is still on the record");
  assert.ok(room.messages.some((m) => m.agent === "super_agent"), "under its own name");
});

test("inviting a third agent while converting seats them too", () => {
  const s = store();
  const thread = pairBetween(s, "andy", "magui");
  const out = promoteA2AThreadToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage, threadId: thread,
    knownAgents: ["andy", "magui", "otro"], participants: ["otro"],
  });
  assert.deepEqual(out.participants.sort(), ["andy", "magui", "otro"]);
});

test("a pair with nobody seatable is refused, not opened empty", () => {
  // Two coding runtimes, or a pair whose agents have since been removed: a room
  // with no members is a thread that can never answer, so it is said plainly.
  const s = store();
  const thread = pairBetween(s, "claude-code", "codex");
  assert.throws(
    () => promoteA2AThreadToGroup({
      storagePath: s.storagePath, logMessage: s.logMessage,
      threadId: thread, knownAgents: ["andy"],
    }),
    /neither side of this pair is an agent/,
  );
});

test("promoting something that is not there fails loudly", () => {
  const s = store();
  assert.throws(() => promoteConversationToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    agentSlug: "magui", conversationId: "2026-01-01-01", participants: ["andy"],
  }), /no conversation/);
  assert.throws(() => promoteA2AThreadToGroup({
    storagePath: s.storagePath, logMessage: s.logMessage,
    threadId: "andy~nadie", knownAgents: ["andy"],
  }), /no a2a thread/);
});
