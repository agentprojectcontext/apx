// GET /api/inbox must not re-parse a project that did not change.
//
// The panel refetches the inbox on every live-feed event, so during a turn it
// ran several times a second — and every run parsed every day file of every
// project's ledger synchronously, holding the event loop for seconds. /health
// then missed the CLI's ping and the CLI tried to start a second daemon.
//
// The fix remembers what each file said until its (mtime, size) moves. These
// tests count parses through that memo: an unchanged tree costs none, and an
// append costs exactly the file that grew.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// APX_HOME before ANY #core import (rule 1): the global ledger hangs off it.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-inbox-memo-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const {
  appendMessageToFs, appendGlobalMessage, readProjectMessages, readRoomRows,
  listGlobalThreads, setLedgerProjectResolver,
} = await import("#core/stores/messages.js");
const { startConversation, appendTurn } = await import("#core/stores/conversations.js");
const { fileMemoStats, clearFileMemo } = await import("#core/util/file-memo.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function apiFor(projects) {
  return buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { permission_mode: "total" } },
    token: "",
  });
}

const a2a = (projectRoot, ts, body) => appendMessageToFs({
  projectRoot, channel: "a2a", direction: "out", type: "agent",
  agent_slug: "scout", author: "scout", body, ts, meta: { from: "scout", to: "lumen" },
});

/** Several days of ledger: a2a, a group room, and the tool noise that dominates a real one. */
function seedProject(storagePath) {
  for (const day of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
    a2a(storagePath, `${day}T10:00:00Z`, `a2a on ${day}`);
    appendMessageToFs({
      projectRoot: storagePath, channel: "group", direction: "out", type: "agent",
      agent_slug: "scout", author: "scout", body: `room on ${day}`, ts: `${day}T11:00:00Z`,
      meta: { group_id: "g1", participants: ["scout", "lumen"] },
    });
    for (let i = 0; i < 20; i++) {
      appendMessageToFs({
        projectRoot: storagePath, channel: "web", direction: "out", type: "tool",
        agent_slug: "scout", author: "scout", body: `tool ${i}`, ts: `${day}T12:00:${String(i).padStart(2, "0")}Z`,
      });
    }
  }
}

test("an unchanged inbox is served without re-parsing a single file", async () => {
  const root = makeTempProject({ name: "acme", agents: [{ slug: "scout" }] });
  const projects = new ProjectManager({});
  const { id } = projects.register(root);
  const { storagePath } = projects.get(id);
  seedProject(storagePath);
  const conv = startConversation({ storagePath, agentSlug: "scout", engine: "mock:test", channel: "web" });
  appendTurn({ filePath: conv.path, role: "user", content: "hola" });
  appendTurn({ filePath: conv.path, role: "assistant", content: "hola, qué hacemos" });
  appendGlobalMessage({ channel: "telegram", direction: "in", type: "user", author: "owner", body: "che", ts: "2026-09-03T09:00:00Z" });
  appendGlobalMessage({ channel: "telegram", direction: "out", type: "agent", agent_slug: "super_agent", body: "acá", ts: "2026-09-03T09:01:00Z" });

  const { server, baseUrl } = await listen(apiFor(projects));
  try {
    clearFileMemo();
    const get = async () => {
      const body = await fetch(`${baseUrl}/api/inbox`).then((r) => r.json());
      return body.data ?? body.items ?? body;
    };

    const first = await get();
    const afterFirst = fileMemoStats().misses;
    assert.ok(afterFirst > 0, "the first request parses");
    assert.ok(first.some((r) => r.kind === "a2a"), "the a2a pair is a row");
    assert.ok(first.some((r) => r.kind === "group"), "the room is a row");
    assert.ok(first.some((r) => r.kind === "agent" && r.agent_slug === "scout"), "the agent chat is a row");
    assert.ok(first.some((r) => r.kind === "super_agent" && r.channel === "telegram"), "the telegram thread is a row");

    const second = await get();
    assert.equal(fileMemoStats().misses, afterFirst, "nothing changed, nothing re-parsed");
    assert.deepEqual(second, first, "and the answer is the same one");

    // One append to one day file: exactly that file is read again.
    a2a(storagePath, "2026-09-03T13:00:00Z", "one more");
    const third = await get();
    assert.equal(fileMemoStats().misses, afterFirst + 1, "only the day that grew is re-parsed");
    const pair = third.find((r) => r.kind === "a2a");
    assert.equal(pair.messages, first.find((r) => r.kind === "a2a").messages + 1);
    assert.match(pair.preview, /one more/);
  } finally {
    server.close();
    cleanupTempProject(root);
  }
});

test("the newest-rows reader answers what the full scan did, opening only the days it needs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-room-rows-"));
  try {
    for (const day of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) {
      for (let i = 0; i < 3; i++) a2a(root, `${day}T10:0${i}:00Z`, `${day} #${i}`);
    }
    for (const limit of [1, 3, 4, 7, 1000]) {
      assert.deepEqual(
        readRoomRows(root, "a2a", { limit }),
        readProjectMessages(root, { channel: "a2a", limit }),
        `limit ${limit}`,
      );
    }
    clearFileMemo();
    readRoomRows(root, "a2a", { limit: 3 });
    assert.equal(fileMemoStats().misses, 1, "three rows are all in the newest day; the older ones stay closed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a remembered day re-derives when its project stamp resolves somewhere else", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "apx-global-memo-"));
  const dir = path.join(base, "web");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "2026-08-05.jsonl"), [
    { ts: "2026-08-05T10:00:00Z", channel: "web", direction: "in", type: "user", author: "owner", body: "hola", meta: { project_id: "4" } },
    { ts: "2026-08-05T10:01:00Z", channel: "web", direction: "out", type: "agent", author: "APX", body: "hola", meta: { project_id: "4" } },
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  try {
    let target = "4";
    setLedgerProjectResolver(() => target);
    assert.equal(listGlobalThreads({ _globalMessagesDir: base })[0].project, "4");
    // The file did not move; the registry did (a project re-registered).
    target = "7";
    assert.equal(listGlobalThreads({ _globalMessagesDir: base })[0].project, "7");
    assert.equal(listGlobalThreads({ project: "4", _globalMessagesDir: base }).length, 0);
  } finally {
    setLedgerProjectResolver(null);
    fs.rmSync(base, { recursive: true, force: true });
  }
});
