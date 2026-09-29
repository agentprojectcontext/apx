// "New chat" lists every agent ONCE.
//
// Imports the web's TypeScript directly (Node strips types natively) — same
// approach as inbox-selection.test.js, for logic with no DOM in it.
//
// The regression: fed the every-channel inbox, the picker showed the
// super-agent once per channel it had spoken on, plus a Discord channel row
// wearing its face. A new chat is always a fresh web session, so those rows
// were the same pick four times over.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { pickableAgents } = await import(
  path.join(ROOT, "src/interfaces/web/src/lib/new-chat.ts")
);

const row = (over) => ({
  project_id: 1,
  agent_slug: "acme-bot",
  kind: "agent",
  channel: "web",
  ...over,
});

test("the super-agent appears once, whatever channels and projects its threads are on", () => {
  const rows = [
    row({ kind: "super_agent", agent_slug: "super_agent", project_id: 0, channel: "discord", agent_name: "#general" }),
    row({ kind: "super_agent", agent_slug: "super_agent", project_id: 0, channel: "telegram" }),
    row({ kind: "super_agent", agent_slug: "super_agent", project_id: 4, channel: "web" }),
    row({ kind: "super_agent", agent_slug: "super_agent", project_id: 0, channel: "whatsapp" }),
  ];
  const out = pickableAgents(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0].channel, "discord", "the first (newest) row wins");
});

test("a project agent appears once per project, and same slug in two projects stays two", () => {
  const out = pickableAgents([
    row({ project_id: 1, channel: "web" }),
    row({ project_id: 1, channel: "telegram" }),
    row({ project_id: 2 }),
  ]);
  assert.deepEqual(out.map((r) => r.project_id), [1, 2]);
});

test("rooms are not agents: a2a, group and runtime rows stay out", () => {
  const out = pickableAgents([
    row({ kind: "a2a" }),
    row({ kind: "group" }),
    row({ kind: "runtime" }),
    row({}),
  ]);
  assert.deepEqual(out.map((r) => r.kind), ["agent"]);
});

test("the sheet asks for the web-scoped roster, not the every-channel one", () => {
  // Asking without a channel is what returns one row per channel per agent.
  const src = fs.readFileSync(
    path.join(ROOT, "src/interfaces/web/src/screens/mobile/NewChatSheet.tsx"),
    "utf8",
  );
  assert.match(src, /useInbox\(true, "web"\)/);
  assert.match(src, /pickableAgents\(rows\)/);
});
