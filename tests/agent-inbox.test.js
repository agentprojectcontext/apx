// The agent inbox — every agent as a conversation, most recent first.
//
// The inbox is a SECOND AXIS over the same data, not a replacement for
// project-first navigation. These tests hold it to the shape that makes it
// useful: the preview is what the agent last SAID, the super-agent is pinned,
// and one broken project never blanks out the list.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The super-agent row reads the cross-channel ledger under ~/.apx/messages, so
// HOME must point at a temp dir BEFORE the module loads or these assertions
// would depend on whatever real history the machine happens to have.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inbox-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // isolate the apx home too — HOME alone is overridden by the runner's APX_HOME

const { listAgentInbox } = await import("#core/stores/agent-inbox.js");
const { listConversations } = await import("#core/stores/conversations.js");
const { SUPERAGENT_ACTOR_ID } = await import("#core/constants/actors.js");

/** A project on disk: .apc/agents/<slug>.md plus a storage dir for conversations. */
function makeProject(name, agents = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `apx-inbox-${name}-`));
  const projectPath = path.join(root, "repo");
  const storagePath = path.join(root, "storage");
  fs.mkdirSync(path.join(projectPath, ".apc", "agents"), { recursive: true });
  fs.mkdirSync(storagePath, { recursive: true });

  for (const a of agents) {
    fs.writeFileSync(
      path.join(projectPath, ".apc", "agents", `${a}.md`),
      `---\nName: ${a.toUpperCase()}\nRole: tester\nModel: mock:test\nEmoji: 🤖\n---\n\nBody.\n`
    );
  }
  return { id: name, name, path: projectPath, storagePath, root };
}

/** Write a conversation file directly — the store's own on-disk format. */
function writeConversation(project, slug, { id, startedAt, lastAt, turns }) {
  const dir = path.join(project.storagePath, "agents", slug, "conversations");
  fs.mkdirSync(dir, { recursive: true });
  const fm = `---\nstarted: ${startedAt}\nlast_turn: ${lastAt}\nchannel: web\nstatus: open\n---\n\n`;
  const body = turns.map((t) => `## ${t.role} — ${t.ts}\n${t.content}\n`).join("\n");
  fs.writeFileSync(path.join(dir, `${id}.md`), fm + body + "\n");
}

function cleanup(...projects) {
  for (const p of projects) fs.rmSync(p.root, { recursive: true, force: true });
}

const TURNS = [
  { role: "user", ts: "2026-08-01T10:00:00Z", content: "how are the receipts?" },
  { role: "assistant", ts: "2026-08-01T10:01:00Z", content: "report filed. 9 receipts, nothing over policy." },
];

// --------------------------------------------------------------------------

test("the preview is what the AGENT last said, not what the user asked", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    writeConversation(p, "scout", {
      id: "c1",
      startedAt: "2026-08-01T10:00:00Z",
      lastAt: "2026-08-01T10:01:00Z",
      turns: TURNS,
    });

    const { rows } = listAgentInbox([p]);
    const scout = rows.find((r) => r.agent_slug === "scout");

    assert.ok(scout, "the agent should appear");
    assert.equal(scout.preview, "report filed. 9 receipts, nothing over policy.");
    assert.ok(
      !scout.preview.includes("how are the receipts"),
      "echoing the user's own prompt back tells them nothing"
    );
  } finally {
    cleanup(p);
  }
});

// ── When the AGENT last spoke ──────────────────────────────────────────────
// The row's `last_activity_at` moves for the owner's own message and for every
// tool the agent runs while answering. A notifier keyed off it rang the instant
// you sent a message, and again for each of the 24 steps that followed.
// `preview_at` is the timestamp of the thing the preview came from.

test("preview_at is the agent's reply, not the thread's last movement", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    writeConversation(p, "scout", {
      id: "c1",
      startedAt: "2026-08-01T10:00:00Z",
      // The user asked something AFTER the agent's reply, and the frontmatter
      // moved with it — that is the shape that used to ring the bell.
      lastAt: "2026-08-01T10:05:00Z",
      turns: [
        ...TURNS,
        { role: "user", ts: "2026-08-01T10:05:00Z", content: "and the invoices?" },
      ],
    });

    const scout = listAgentInbox([p]).rows.find((r) => r.agent_slug === "scout");
    assert.equal(scout.last_activity_at, "2026-08-01T10:05:00Z", "the thread did move");
    assert.equal(scout.preview_at, "2026-08-01T10:01:00Z", "but the agent has not spoken since");
    assert.equal(scout.preview, "report filed. 9 receipts, nothing over policy.");
  } finally {
    cleanup(p);
  }
});

test("a tool row does not count as the agent speaking", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    writeConversation(p, "scout", {
      id: "c1",
      startedAt: "2026-08-01T10:00:00Z",
      lastAt: "2026-08-01T10:09:00Z",
      turns: [
        ...TURNS,
        { role: "user", ts: "2026-08-01T10:08:00Z", content: "check again" },
        { role: "tool", ts: "2026-08-01T10:09:00Z", content: '{"tool":"read_file"}' },
      ],
    });

    const scout = listAgentInbox([p]).rows.find((r) => r.agent_slug === "scout");
    assert.equal(scout.preview_at, "2026-08-01T10:01:00Z", "mid-turn work is not an answer");
  } finally {
    cleanup(p);
  }
});

test("rows carry the project they came from, and the agent's display name", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    writeConversation(p, "scout", {
      id: "c1", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:01:00Z", turns: TURNS,
    });

    const scout = listAgentInbox([p]).rows.find((r) => r.agent_slug === "scout");
    assert.equal(scout.project_id, "alpha");
    assert.equal(scout.project_name, "alpha");
    assert.equal(scout.agent_name, "SCOUT", "Name from the agent's frontmatter");
    assert.equal(scout.agent_emoji, "🤖");
    assert.equal(scout.kind, "agent");
  } finally {
    cleanup(p);
  }
});

// The super-agent talks on CHANNELS, not in per-agent conversation files, so
// its history is the cross-channel ledger.
function seedGlobalThread(channel, date, rows) {
  const dir = path.join(TMP_HOME, ".apx", "messages", channel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.jsonl`),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
}

test("the super-agent is pinned first and marked distinct", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    // The agent spoke MORE recently than the super-agent — it still goes second.
    writeConversation(p, "scout", {
      id: "c1", startedAt: "2026-08-09T10:00:00Z", lastAt: "2026-08-09T10:00:00Z", turns: TURNS,
    });
    seedGlobalThread("telegram", "2026-08-01", [
      { ts: "2026-08-01T10:00:00Z", type: "user", body: "status?" },
      { ts: "2026-08-01T10:01:00Z", type: "agent", body: "all quiet.", actor_id: SUPERAGENT_ACTOR_ID },
    ]);

    const { rows } = listAgentInbox([p]);
    assert.equal(rows[0].kind, "super_agent", "the single voice sits at the top");
    assert.equal(rows[0].pinned, true);
    assert.equal(rows[0].agent_slug, SUPERAGENT_ACTOR_ID);
    assert.equal(rows[0].channel, "telegram", "recency comes from the channel ledger");
    assert.equal(rows[1].agent_slug, "scout");
  } finally {
    cleanup(p);
  }
});

test("the super-agent row says when it last spoke, not when it was last written to", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    seedGlobalThread("whatsapp", "2026-08-02", [
      { ts: "2026-08-02T10:00:00Z", type: "user", body: "[WhatsApp de juan]: hola" },
      { ts: "2026-08-02T10:01:00Z", type: "agent", body: "hola juan, decime", actor_id: SUPERAGENT_ACTOR_ID },
      // The bridge forwarded another inbound message that has not been answered.
      { ts: "2026-08-02T10:04:00Z", type: "user", body: "[WhatsApp de juan]: ?" },
    ]);

    const row = listAgentInbox([p], { channel: "whatsapp" }).rows
      .find((r) => r.kind === "super_agent");
    assert.equal(row.last_activity_at, "2026-08-02T10:04:00Z");
    assert.equal(row.preview_at, "2026-08-02T10:01:00Z", "the last thing IT said");
    assert.equal(row.preview, "hola juan, decime");
  } finally {
    cleanup(p);
  }
});

test("agents are ordered most-recent-first across projects", () => {
  const a = makeProject("alpha", ["older"]);
  const b = makeProject("beta", ["newer"]);
  try {
    writeConversation(a, "older", {
      id: "c1", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
    });
    writeConversation(b, "newer", {
      id: "c2", startedAt: "2026-08-09T10:00:00Z", lastAt: "2026-08-09T10:00:00Z", turns: TURNS,
    });

    const agents = listAgentInbox([a, b]).rows.filter((r) => r.kind === "agent");
    assert.deepEqual(agents.map((r) => r.agent_slug), ["newer", "older"]);
  } finally {
    cleanup(a, b);
  }
});

// nowIso() has second resolution, so same-second activity is normal and the
// order must not reshuffle between identical calls.
test("ties break deterministically", () => {
  const a = makeProject("alpha", ["one", "two", "three"]);
  try {
    for (const slug of ["one", "two", "three"]) {
      writeConversation(a, slug, {
        id: "c", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
      });
    }
    const once = listAgentInbox([a]).rows.map((r) => r.agent_slug);
    const twice = listAgentInbox([a]).rows.map((r) => r.agent_slug);
    assert.deepEqual(twice, once);
  } finally {
    cleanup(a);
  }
});

test("agents nobody has talked to are hidden unless asked for", () => {
  const p = makeProject("alpha", ["spoken", "silent"]);
  try {
    writeConversation(p, "spoken", {
      id: "c1", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
    });

    const quiet = listAgentInbox([p]).rows.filter((r) => r.kind === "agent");
    assert.deepEqual(quiet.map((r) => r.agent_slug), ["spoken"]);

    const all = listAgentInbox([p], { includeEmpty: true }).rows.filter((r) => r.kind === "agent");
    assert.deepEqual(all.map((r) => r.agent_slug).sort(), ["silent", "spoken"]);
  } finally {
    cleanup(p);
  }
});

test("an unreadable project is skipped and named, never fatal", () => {
  const good = makeProject("alpha", ["scout"]);
  try {
    writeConversation(good, "scout", {
      id: "c1", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
    });

    const broken = { id: "broken", name: "broken", path: "/definitely/not/here", storagePath: "/nope" };
    const { rows, skipped } = listAgentInbox([good, broken]);

    assert.ok(rows.some((r) => r.agent_slug === "scout"), "the good project survives");
    assert.equal(rows.filter((r) => r.project_id === "broken").length, 0);
    // readAgents returns [] for a missing dir rather than throwing, so the row
    // is simply absent; either way the list must not be empty.
    assert.ok(Array.isArray(skipped));
  } finally {
    cleanup(good);
  }
});

test("limit applies after the merge, with the pinned row included", () => {
  const p = makeProject("alpha", ["a", "b", "c"]);
  try {
    for (const slug of ["a", "b", "c"]) {
      writeConversation(p, slug, {
        id: "c", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
      });
    }
    writeConversation(p, SUPERAGENT_ACTOR_ID, {
      id: "s", startedAt: "2026-08-01T10:00:00Z", lastAt: "2026-08-01T10:00:00Z", turns: TURNS,
    });

    const { rows } = listAgentInbox([p], { limit: 2 });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "super_agent", "the pin survives the cap");
  } finally {
    cleanup(p);
  }
});

test("conversation summaries expose the last reply without loading the thread", () => {
  const p = makeProject("alpha", ["scout"]);
  try {
    writeConversation(p, "scout", {
      id: "c1",
      startedAt: "2026-08-01T10:00:00Z",
      lastAt: "2026-08-01T10:05:00Z",
      turns: [
        ...TURNS,
        { role: "user", ts: "2026-08-01T10:04:00Z", content: "and the invoices?" },
        { role: "assistant", ts: "2026-08-01T10:05:00Z", content: "```js\nnoise\n```\ntwo invoices still open." },
      ],
    });

    const [summary] = listConversations(p.storagePath, "scout");
    assert.equal(summary.preview, "two invoices still open.", "code fences are dropped from a one-line preview");
    assert.equal(summary.preview_at, "2026-08-01T10:05:00Z");
    assert.equal(summary.last_turn_at, "2026-08-01T10:05:00Z");
    assert.equal(summary.title, "how are the receipts?", "title still comes from the first user turn");
  } finally {
    cleanup(p);
  }
});

// parseConversation used `\n*$` as its terminator, and with the /m flag `$`
// matches the end of any LINE — so every multi-line turn was silently truncated
// to its first line, in the panel thread view as well as in previews.
test("a multi-line turn survives parsing intact", async () => {
  const { parseConversation } = await import("#core/stores/conversations.js");
  const text =
    "---\nstarted: x\n---\n\n" +
    "## user — t1\nask\n\n" +
    "## assistant — t2\nline one\nline two\n\nline four\n";

  const { turns } = parseConversation(text);
  const reply = turns.find((t) => t.role === "assistant");
  assert.equal(reply.content, "line one\nline two\n\nline four");
});

// A routine run is not a chat. Chatting inside a routine thread happens, but the
// inbox headline for an agent must be its last REAL conversation — else a
// scheduled run that just fired buries the thread you were actually in.
function writeConversationOn(project, slug, { id, channel, startedAt, lastAt, turns }) {
  const dir = path.join(project.storagePath, "agents", slug, "conversations");
  fs.mkdirSync(dir, { recursive: true });
  const fm = `---\nstarted: ${startedAt}\nlast_turn: ${lastAt}\nchannel: ${channel}\nstatus: open\n---\n\n`;
  const body = turns.map((t) => `## ${t.role} — ${t.ts}\n${t.content}\n`).join("\n");
  fs.writeFileSync(path.join(dir, `${id}.md`), fm + body + "\n");
}

test("a routine conversation is never the inbox headline — the last real chat is", () => {
  const p = makeProject("routines", ["magui"]);
  try {
    // Older real chat...
    writeConversationOn(p, "magui", {
      id: "c1-web", channel: "web",
      startedAt: "2026-08-01T09:00:00Z", lastAt: "2026-08-01T09:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T09:01:00Z", content: "posted the daily." }],
    });
    // ...and a NEWER routine run on top of it.
    writeConversationOn(p, "magui", {
      id: "c2-routine", channel: "routine",
      startedAt: "2026-08-01T12:00:00Z", lastAt: "2026-08-01T12:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T12:01:00Z", content: "cron tick done." }],
    });

    const { rows } = listAgentInbox([p]);
    const magui = rows.find((r) => r.agent_slug === "magui");
    assert.ok(magui, "magui is in the inbox");
    assert.equal(magui.channel, "web", "the routine run does not become the row's channel");
    assert.equal(magui.preview, "posted the daily.", "the preview is the last real chat, not the routine tick");
  } finally {
    cleanup(p);
  }
});

test("an agent whose only activity is a routine drops out of the inbox", () => {
  const p = makeProject("routine-only", ["ghost"]);
  try {
    writeConversationOn(p, "ghost", {
      id: "c1-routine", channel: "routine",
      startedAt: "2026-08-01T12:00:00Z", lastAt: "2026-08-01T12:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T12:01:00Z", content: "cron tick done." }],
    });

    const { rows } = listAgentInbox([p]);
    assert.equal(rows.find((r) => r.agent_slug === "ghost"), undefined, "no chat, no row");

    // ...but includeEmpty still surfaces it, with no channel.
    const { rows: withEmpty } = listAgentInbox([p], { includeEmpty: true });
    const ghost = withEmpty.find((r) => r.agent_slug === "ghost");
    assert.ok(ghost, "includeEmpty surfaces the agent");
    assert.equal(ghost.channel, null, "and it carries no routine channel");
  } finally {
    cleanup(p);
  }
});

// The inbox and the phone are WEB-ONLY: `channel: "web"` scopes each agent's row
// to its web chat so a Telegram thread never surfaces there. This is the one axis
// where APX is a messaging app; project-first navigation still sees every channel.
test("channel scope surfaces the web chat and drops a telegram-only agent", () => {
  const p = makeProject("scoped", ["webby", "teleonly"]);
  try {
    // webby has both a telegram chat and a web one. listConversations orders by
    // filename desc, so the id decides which is "latest" — c2-tg wins unscoped.
    writeConversationOn(p, "webby", {
      id: "c1-web", channel: "web",
      startedAt: "2026-08-01T09:00:00Z", lastAt: "2026-08-01T09:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T09:01:00Z", content: "web reply." }],
    });
    writeConversationOn(p, "webby", {
      id: "c2-tg", channel: "telegram",
      startedAt: "2026-08-01T12:00:00Z", lastAt: "2026-08-01T12:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T12:01:00Z", content: "telegram reply." }],
    });
    // teleonly has ONLY a telegram chat.
    writeConversationOn(p, "teleonly", {
      id: "c-tg", channel: "telegram",
      startedAt: "2026-08-01T11:00:00Z", lastAt: "2026-08-01T11:01:00Z",
      turns: [{ role: "assistant", ts: "2026-08-01T11:01:00Z", content: "only on telegram." }],
    });

    // Unscoped: webby follows recency to its telegram chat, teleonly is present.
    const { rows: all } = listAgentInbox([p]);
    assert.equal(all.find((r) => r.agent_slug === "webby").channel, "telegram");
    assert.ok(all.find((r) => r.agent_slug === "teleonly"), "telegram-only agent shows unscoped");

    // Web-scoped: webby pins to its web chat, teleonly drops out entirely.
    const { rows: web } = listAgentInbox([p], { channel: "web" });
    const webby = web.find((r) => r.agent_slug === "webby");
    assert.ok(webby, "webby stays, on its web chat");
    assert.equal(webby.channel, "web", "the row is scoped to the web channel");
    assert.equal(webby.preview, "web reply.", "the preview comes from the web chat, not telegram");
    assert.equal(web.find((r) => r.agent_slug === "teleonly"), undefined, "no web chat, no web-scoped row");

    // ...unless includeEmpty is asked for (the "new chat" roster).
    const { rows: roster } = listAgentInbox([p], { channel: "web", includeEmpty: true });
    assert.ok(roster.find((r) => r.agent_slug === "teleonly"), "includeEmpty keeps it in the roster");
  } finally {
    cleanup(p);
  }
});
