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

const { mascotNotificationsFromEvents, isAgentFinalEvent } =
  await import("#core/events/mascot-notify.js");
const { appendGlobalMessage, appendMessageToFs } = await import("#core/stores/messages.js");
const { onMessageEvent, resetEventBus } = await import("#core/events/bus.js");

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
      { direction: "out", type: "agent", channel: "a2a", author: "martin", agent_slug: "martin" },
    ]),
    [
      "Roby respondió en Telegram",
      "sofia respondió en Grupo",
      "martin respondió en A2A",
    ],
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

test("desktop and android pets render the daemon list, never the owner's send", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const desktop = fs.readFileSync(path.join(root, "src/interfaces/desktop/main.js"), "utf8");
  const android = fs.readFileSync(
    path.join(root, "src/interfaces/android/app/src/main/java/dev/agentprojectcontext/apx/MessageFrameParser.java"),
    "utf8",
  );
  assert.match(desktop, /Array\.isArray\(msg\.notifications\)/);
  assert.doesNotMatch(desktop, /direction !== "in"/);
  assert.match(android, /frame\.has\("notifications"\)/);
  assert.match(android, /isAgentFinal/);
  assert.doesNotMatch(android, /!"in"\.equals\(event\.optString\("direction"\)\)/);
});
