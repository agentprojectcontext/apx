// Where an inbox row opens — for the one kind of row that is not an agent's
// conversation.
//
// A runtime room's slug is the synthetic `runtime:<id>`, which owns no
// conversation file. Every surface that turned a row into a destination built
// `chatPath(pid, row.agent_slug, keyFor(row))` by hand, so the phone opened
//
//   /m/chat/4/runtime%3A2026-09-20-01/2026-09-20-01
//   → GET …/agents/runtime%3A2026-09-20-01/conversations/… → 404
//
// and showed an empty composer under "conversation not found" (2026-09-20).
// Fixing the chat list alone left four other doors open — the attention tab,
// a notification's deep link, and the two "open in project" entries — which is
// how it came back twenty minutes later from a different screen. The branch
// lives in `rowPath` now, and this file is what keeps the doors together.
//
// Imports the web's TypeScript directly (Node strips types natively), the same
// way inbox-selection.test.js does for logic with no DOM in it.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { rowPath, runtimeDetailPath, agentCardUrl, chatInProjectUrl, urlLooksAt } = await import(
  path.join(ROOT, "src/interfaces/web/src/screens/mobile/routes.ts")
);

const runtimeRow = {
  project_id: 4,
  agent_slug: "runtime:2026-09-20-01",
  agent_name: "Contestá solamente con la palabra: listo",
  kind: "runtime",
  runtime: "claude-code",
  conversation_id: "2026-09-20-01",
  channel: "runtime",
  messages: 2,
  preview: "claude-code: listo",
  last_activity_at: "2026-09-20T23:36:25Z",
  pinned: false,
  project_name: "tecnomanu",
  project_path: "/x",
  agent_emoji: null,
  agent_icon: "claude-code",
};

const agentRow = {
  ...runtimeRow,
  agent_slug: "romi",
  kind: "agent",
  runtime: undefined,
  channel: "web",
  conversation_id: "c-1",
};

test("a runtime room opens as its own chat, never on the chat pane's path", () => {
  // Reached from the list of CONVERSATIONS, so it opens as one — its own
  // full-screen route, not the sessions list with a sheet on top of it:
  // "en el chat, si abro una sesión debe ser en modo chat" (Manu, 2026-09-20).
  const to = rowPath(runtimeRow);
  assert.equal(to, "/m/runtime/4/2026-09-20-01");
  // The shape that 404'd, spelled out so nobody reintroduces it: the slug
  // `runtime:<id>` owns no conversation file.
  assert.ok(!to.includes("/m/chat/"), "a room has no conversation file to open");
});

test("the sessions list keeps its own way in, for the other question", () => {
  // Same room, different screen: there the RUN is the subject (engine, folder,
  // exit code), so it opens as the floating detail over the list.
  const to = runtimeDetailPath(4, "2026-09-20-01");
  const q = new URL(to, "http://localhost").searchParams;
  assert.match(to, /^\/m\/runtimes\?/);
  assert.equal(q.get("session"), "2026-09-20-01");
  assert.equal(q.get("pid"), "4");
});

test("every other row still opens its chat, unchanged", () => {
  const to = rowPath(agentRow);
  assert.match(to, /^\/m\/chat\/4\/romi/);
});

test("the project-side entries point at the room too, not at an agent card", () => {
  // `runtime:<id>` names nobody on the roster: there is no ficha to open.
  assert.match(agentCardUrl(runtimeRow), /^\/m\/runtime\//);
  assert.match(chatInProjectUrl(runtimeRow), /^\/m\/runtime\//);
  assert.match(agentCardUrl(agentRow), /^\/p\/4\/agents\/romi$/);
});

test("'am I already reading this?' recognises the room, so the bell stays quiet", () => {
  // Both places that show it: its own chat route, and the list with it open.
  assert.equal(urlLooksAt("http://x/m/runtime/4/2026-09-20-01", runtimeRow), true);
  assert.equal(urlLooksAt("http://x/m/runtime/4/otra", runtimeRow), false);
  assert.equal(urlLooksAt("http://x/m/runtimes?session=2026-09-20-01&pid=4", runtimeRow), true);
  assert.equal(urlLooksAt("http://x/m/runtimes?session=otra&pid=4", runtimeRow), false);
  // Without this the answer was always no — and a notification fired for the
  // message on the screen the person was looking at.
  assert.equal(urlLooksAt("http://x/m/chat", runtimeRow), false);
});
