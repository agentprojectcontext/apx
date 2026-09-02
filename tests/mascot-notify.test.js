// The pet bubbles an agent's launched final — never the owner's own send.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-mascot-notify-"));
process.env.HOME = HOME;
process.env.APX_HOME = path.join(HOME, ".apx");

const { mascotNotificationsFromEvents, mascotNoticesFromEvents, isAgentFinalEvent, NOTICE_CHANNELS } =
  await import("#core/events/mascot-notify.js");
const { appendGlobalMessage, appendMessageToFs } = await import("#core/stores/messages.js");
const { onMessageEvent, resetEventBus } = await import("#core/events/bus.js");
const { resolveAgentName } = await import("#core/identity/self.js");

function capture(fn) {
  const seen = [];
  const off = onMessageEvent((e) => seen.push(e));
  try { fn(); } finally { off(); }
  return seen;
}

test("the owner's send is not news", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "in", type: "user", channel: "telegram", author: "@manu" },
      { direction: "in", type: "user", channel: "group", author: "owner" },
      { direction: "in", type: "user", channel: "web", author: "user" },
    ]),
    [],
  );
});

test("an agent's launched final on telegram, group, or a2a is one bubble per agent", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "telegram", author: "Roby", agent_slug: "super_agent" },
      { direction: "out", type: "agent", channel: "group", author: "sofia", agent_slug: "sofia" },
      { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "roby" },
    ]),
    [
      "Roby respondió en Telegram",
      "sofia respondió en Grupo",
      "Nuevo mensaje de Magui a Roby",
    ],
  );
});

test("an a2a bubble names both ends, and one sender reaching two peers is two bubbles", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "roby" },
      { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "martin" },
      { direction: "out", type: "agent", channel: "a2a", author: "roby", agent_slug: "roby", to: "magui" },
    ]),
    [
      "Nuevo mensaje de Magui a Roby",
      "Nuevo mensaje de Magui a Martin",
      "Nuevo mensaje de Roby a Magui",
    ],
  );
});

test("the super-agent is named, not filed: a bubble says Roby, not super_agent", () => {
  // The ledger keys one thread per correspondent by ACTOR ID, so every alias
  // (`roby`, `apx`, `default`) lands on `super_agent`. That is the right id and
  // the wrong word for a sentence — "a Super_agent" is not who the owner talks
  // to every day. The word is whatever HE renamed it to, which is why this
  // reads the identity instead of pinning a name the owner is free to change.
  const roby = resolveAgentName();
  assert.notEqual(roby, "super_agent");
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "super_agent" },
      { direction: "out", type: "agent", channel: "a2a", author: "super_agent", agent_slug: "super_agent", to: "magui" },
    ]),
    [
      `Nuevo mensaje de Magui a ${roby}`,
      `Nuevo mensaje de ${roby} a Magui`,
    ],
  );
});

test("an a2a row with no recipient falls back to naming the channel", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "a2a", author: "martin", agent_slug: "martin" },
    ]),
    ["martin respondió en A2A"],
  );
});

test("a mid-turn Telegram chunk is not the launched final", () => {
  assert.equal(isAgentFinalEvent({
    direction: "out", type: "agent", channel: "telegram", streamed: true, author: "Roby",
  }), false);
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "telegram", streamed: true, author: "Roby" },
      { direction: "out", type: "agent", channel: "telegram", author: "Roby", agent_slug: "super_agent" },
    ]),
    ["Roby respondió en Telegram"],
  );
});

test("a2a inbound copies and web 1:1 replies do not bubble", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "in", type: "agent", channel: "a2a", author: "sofia" },
      { direction: "out", type: "agent", channel: "web", author: "sofia", agent_slug: "sofia" },
      { direction: "out", type: "tool", channel: "telegram", author: "Roby" },
    ]),
    [],
  );
});

test("mobility and routine deliveries keep their own headlines", () => {
  assert.deepEqual(
    mascotNotificationsFromEvents([
      { direction: "out", type: "agent", channel: "telegram", via: "mobility_delivery", notify: "Pasá por La Anónima", author: "Roby" },
      { direction: "out", type: "agent", channel: "web", via: "routine_delivery", agent_slug: "golf-coach", notify: "🏌️ Tip Golf" },
    ]),
    ["Pasá por La Anónima", "golf-coach: 🏌️ Tip Golf"],
  );
});

test("a telegram final row announces final/author so the pet can tell chunk from close", () => {
  resetEventBus();
  const seen = capture(() => appendGlobalMessage({
    channel: "telegram",
    direction: "out",
    type: "agent",
    author: "Roby",
    agent_slug: "super_agent",
    body: "listo",
    meta: { final: true },
  }));
  assert.equal(seen[0].final, true);
  assert.equal(seen[0].streamed, null);
  assert.equal(seen[0].author, "Roby");
  assert.deepEqual(mascotNotificationsFromEvents(seen), ["Roby respondió en Telegram"]);
});

test("a streamed telegram chunk is flagged so the pet can skip it", () => {
  resetEventBus();
  const seen = capture(() => appendGlobalMessage({
    channel: "telegram",
    direction: "out",
    type: "agent",
    author: "Roby",
    body: "estoy en eso",
    meta: { streamed: true },
  }));
  assert.equal(seen[0].streamed, true);
  assert.deepEqual(mascotNotificationsFromEvents(seen), []);
});

test("a group agent reply is a launched final on the project ledger", () => {
  resetEventBus();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-group-final-"));
  const seen = capture(() => appendMessageToFs({
    projectRoot: root,
    channel: "group",
    direction: "out",
    type: "agent",
    agent_slug: "sofia",
    author: "sofia",
    body: "voy",
    meta: { group_id: "g1", final: true },
  }));
  assert.equal(seen[0].final, true);
  assert.equal(seen[0].author, "sofia");
  assert.deepEqual(mascotNotificationsFromEvents(seen), ["sofia respondió en Grupo"]);
});

test("an a2a row announces its recipient, and no other channel does", () => {
  resetEventBus();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-final-"));
  const seen = capture(() => {
    appendMessageToFs({
      projectRoot: root,
      channel: "a2a",
      direction: "out",
      type: "agent",
      agent_slug: "magui",
      author: "magui",
      body: "quedó programado el reel",
      meta: { to: "roby", final: true },
    });
    // The mirror written under the recipient. It is the same utterance seen
    // from the other side, so it must not bubble a second time.
    appendMessageToFs({
      projectRoot: root,
      channel: "a2a",
      direction: "in",
      type: "agent",
      agent_slug: "roby",
      author: "magui",
      body: "quedó programado el reel",
      meta: { from: "magui" },
    });
    // `to` is an agent name only on a2a. Anywhere else it could be an address,
    // so it stays off the wire.
    appendMessageToFs({
      projectRoot: root,
      channel: "telegram",
      direction: "out",
      type: "agent",
      agent_slug: "super_agent",
      author: "Roby",
      body: "listo",
      meta: { to: "123456789", final: true },
    });
  });
  assert.equal(seen[0].to, "roby");
  assert.equal(seen[2].to, null);
  assert.deepEqual(mascotNotificationsFromEvents(seen), [
    "Nuevo mensaje de Magui a Roby",
    "Roby respondió en Telegram",
  ]);
});

test("every bubble carries the channel a device filters on", () => {
  assert.deepEqual(
    mascotNoticesFromEvents([
      { direction: "out", type: "agent", channel: "telegram", author: "Roby", agent_slug: "super_agent" },
      { direction: "out", type: "agent", channel: "group", author: "sofia", agent_slug: "sofia" },
      { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "roby" },
    ]),
    [
      { text: "Roby respondió en Telegram", channel: "telegram" },
      { text: "sofia respondió en Grupo", channel: "group" },
      { text: "Nuevo mensaje de Magui a Roby", channel: "a2a" },
    ],
  );
});

test("a delivery is tagged by what it IS, not by the channel it was filed on", () => {
  // The whole point of the tag: the errand notice rides Telegram and the
  // routine one is filed on web, so a phone that muted Telegram to stop the
  // duplicate replies would otherwise lose the car — which is the one bubble
  // it cannot get any other way.
  assert.deepEqual(
    mascotNoticesFromEvents([
      { direction: "out", type: "agent", channel: "telegram", via: "mobility_delivery", notify: "Pasá por La Anónima", author: "Roby" },
      { direction: "out", type: "agent", channel: "web", via: "routine_delivery", agent_slug: "golf-coach", notify: "🏌️ Tip Golf" },
    ]),
    [
      { text: "Pasá por La Anónima", channel: "mobility" },
      { text: "golf-coach: 🏌️ Tip Golf", channel: "routine" },
    ],
  );
});

test("the lines are the notices, and every channel is one a client can offer", () => {
  const events = [
    { direction: "out", type: "agent", channel: "telegram", via: "mobility_delivery", notify: "Pasá por La Anónima" },
    { direction: "out", type: "agent", channel: "web", via: "routine_delivery", agent_slug: "golf-coach", notify: "🏌️" },
    { direction: "out", type: "agent", channel: "telegram", author: "Roby", agent_slug: "super_agent" },
    { direction: "out", type: "agent", channel: "group", author: "sofia", agent_slug: "sofia" },
    { direction: "out", type: "agent", channel: "a2a", author: "magui", agent_slug: "magui", to: "roby" },
  ];
  const notices = mascotNoticesFromEvents(events);
  // The flat list an older APK still reads is exactly these lines, in order.
  assert.deepEqual(mascotNotificationsFromEvents(events), notices.map((n) => n.text));
  // A tag outside the catalog is a switch the settings dialog never offers,
  // so the bubble would be unmutable and unexplained.
  for (const notice of notices) assert.ok(NOTICE_CHANNELS.includes(notice.channel), notice.channel);
});

test("desktop and android pets render the daemon list, never the owner's send", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const desktop = fs.readFileSync(path.join(root, "src/interfaces/desktop/main.js"), "utf8");
  const android = fs.readFileSync(
    path.join(root, "src/interfaces/android/app/src/main/java/dev/agentprojectcontext/apx/MessageFrameParser.java"),
    "utf8",
  );
  assert.match(desktop, /Array\.isArray\(msg\.notifications\)/);
  assert.doesNotMatch(desktop, /direction !== "in"/);
  assert.match(android, /frame\.has\("notices"\)/);
  assert.match(android, /frame\.has\("notifications"\)/);
  assert.match(android, /isAgentFinal/);
  assert.doesNotMatch(android, /!"in"\.equals\(event\.optString\("direction"\)\)/);
});
