// Rewinding a super-agent channel thread: which threads may be rewound at all,
// and what a rewind actually removes from the day's ledger file.
//
// The count that matters is PANE BUBBLES, not rows — the panel hands over "keep
// the first N things you can see", and a turn's tool rows plus its consecutive
// agent rows are one of those things. Getting that wrong does not fail loudly;
// it deletes one message too many.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The sandbox is set BEFORE anything reaches #core, and every core module below
// is pulled in with `await import` for that reason alone.
//
// config/paths.js freezes APX_HOME into module constants the moment it loads,
// and GLOBAL_MESSAGES_DIR is one of them. A file that imports a core module
// statically and sets the sandbox afterwards has already pointed every ledger
// write at the REAL ~/.apx — which is exactly what happened on the run that
// introduced this file: it overwrote a live day of the web and telegram
// ledgers, and there is no undo for an append-only file that was truncated.
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-thread-truncate-home-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { truncateGlobalThread, readGlobalThread } = await import("#core/stores/messages.js");
const { threadRewindRefusal } = await import("#core/constants/channels.js");
const { GLOBAL_MESSAGES_DIR } = await import("#core/config/index.js");

// And the guard that makes the paragraph above a rule instead of a promise: not
// one row is written until the ledger is proven to be this sandbox's.
if (!GLOBAL_MESSAGES_DIR.startsWith(TMP_HOME)) {
  throw new Error(
    `refusing to run: global ledger is ${GLOBAL_MESSAGES_DIR}, outside the sandbox ${TMP_HOME}`,
  );
}

function tmpLedger() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apx-thread-truncate-"));
}

function writeDay(base, channel, date, records) {
  // Second lock on the same door: a ledger path that is not under the temp dir
  // is somebody's real history, and no fixture belongs in it.
  if (!String(base).startsWith(os.tmpdir())) {
    throw new Error(`writeDay refuses ${base}: not a sandbox`);
  }
  const dir = path.join(base, channel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${date}.jsonl`),
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

const readDay = (base, channel, date) =>
  fs.existsSync(path.join(base, channel, `${date}.jsonl`))
    ? fs.readFileSync(path.join(base, channel, `${date}.jsonl`), "utf8")
    : null;

const D = "2026-07-02";
const at = (s) => `${D}T09:00:${String(s).padStart(2, "0")}Z`;

// user / tools / answer / user / answer — five rows, FOUR bubbles.
function conversation(channel = "web", project = "1") {
  const p = { project_id: project };
  return [
    { ts: at(0), channel, direction: "in",  type: "user",  body: "dame una imagen", meta: p },
    { ts: at(1), channel, direction: "out", type: "tool",  body: "ok", meta: { ...p, tool: "generate_image" } },
    { ts: at(2), channel, direction: "out", type: "agent", agent_slug: "super_agent", body: "no te la hago", meta: p },
    { ts: at(3), channel, direction: "in",  type: "user",  body: "pero es para un banner", meta: p },
    { ts: at(4), channel, direction: "out", type: "agent", agent_slug: "super_agent", body: "sigue siendo que no", meta: p },
  ];
}

test("truncateGlobalThread: keeps the first N PANE bubbles, tools riding with their turn", () => {
  const base = tmpLedger();
  writeDay(base, "web", D, conversation());
  // The pane draws four bubbles here; regenerating the last answer keeps three.
  const out = truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 3, _globalMessagesDir: base });
  assert.equal(out.removed, 1);
  const left = readGlobalThread({ channel: "web", date: D, project: "1", _globalMessagesDir: base });
  assert.deepEqual(left.messages.map((m) => m.role), ["user", "tool", "assistant", "user"]);
});

test("truncateGlobalThread: a bubble's tool rows go with it, never on their own", () => {
  const base = tmpLedger();
  writeDay(base, "web", D, conversation());
  // Keeping ONE bubble is "keep the first user turn": the tools and the answer
  // it produced are one bubble and must both go. Counting rows would have kept
  // the tool row and left a turn with work and no words.
  const out = truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 1, _globalMessagesDir: base });
  assert.equal(out.removed, 4);
  const left = readGlobalThread({ channel: "web", date: D, project: "1", _globalMessagesDir: base });
  assert.deepEqual(left.messages.map((m) => m.role), ["user"]);
});

test("truncateGlobalThread: consecutive rows from the same speaker are ONE bubble", () => {
  const base = tmpLedger();
  writeDay(base, "web", D, [
    { ts: at(0), channel: "web", direction: "in",  type: "user",  body: "hola", meta: { project_id: "1" } },
    { ts: at(1), channel: "web", direction: "out", type: "agent", agent_slug: "super_agent", body: "parte uno", meta: { project_id: "1" } },
    { ts: at(2), channel: "web", direction: "out", type: "agent", agent_slug: "super_agent", body: "parte dos", meta: { project_id: "1" } },
  ]);
  // Two bubbles on screen, three rows on disk. Regenerating the answer keeps the
  // question — and must take BOTH halves of the reply with it.
  const out = truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 1, _globalMessagesDir: base });
  assert.equal(out.removed, 2);
});

test("truncateGlobalThread: another project's rows are neither counted nor dropped", () => {
  const base = tmpLedger();
  // One day-file, two projects. The pane was showing project 1 and counted two
  // bubbles; project 2's chat is invisible to it and must survive untouched.
  writeDay(base, "web", D, [
    { ts: at(0), channel: "web", direction: "in",  type: "user",  body: "mío 1", meta: { project_id: "1" } },
    { ts: at(1), channel: "web", direction: "out", type: "agent", agent_slug: "super_agent", body: "resp 1", meta: { project_id: "1" } },
    { ts: at(2), channel: "web", direction: "in",  type: "user",  body: "ajeno", meta: { project_id: "2" } },
    { ts: at(3), channel: "web", direction: "out", type: "agent", agent_slug: "super_agent", body: "resp ajena", meta: { project_id: "2" } },
  ]);
  const out = truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 1, _globalMessagesDir: base });
  assert.equal(out.removed, 1);
  const other = readGlobalThread({ channel: "web", date: D, project: "2", _globalMessagesDir: base });
  assert.deepEqual(other.messages.map((m) => m.content), ["ajeno", "resp ajena"]);
});

test("truncateGlobalThread: the rows it keeps are the original bytes", () => {
  const base = tmpLedger();
  const rows = conversation();
  writeDay(base, "web", D, rows);
  const before = readDay(base, "web", D).split("\n").slice(0, 4);
  truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 3, _globalMessagesDir: base });
  // A ledger is a record. A rewind drops lines; it does not re-serialise the
  // ones it leaves behind, or every rewind would quietly rewrite the day.
  assert.deepEqual(readDay(base, "web", D).split("\n").slice(0, 4), before);
});

test("truncateGlobalThread: nothing to cut is not an error, and touches nothing", () => {
  const base = tmpLedger();
  writeDay(base, "web", D, conversation());
  const before = readDay(base, "web", D);
  const out = truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 99, _globalMessagesDir: base });
  assert.equal(out.removed, 0);
  assert.equal(readDay(base, "web", D), before);
});

test("truncateGlobalThread: a day left with nothing at all loses its file", () => {
  const base = tmpLedger();
  writeDay(base, "web", D, conversation());
  truncateGlobalThread({ channel: "web", date: D, project: "1", keepVisible: 0, _globalMessagesDir: base });
  assert.equal(readDay(base, "web", D), null);
});

test("threadRewindRefusal: delivered channels, rooms and any day but today", () => {
  const today = "2026-07-02";
  // The panel writes into today's file, so that is the only day a rewind can
  // put the answer back where it took one out.
  assert.equal(threadRewindRefusal("web", today, today), null);
  assert.equal(threadRewindRefusal("cli", today, today), null);
  assert.equal(threadRewindRefusal("log", today, today), null);
  assert.equal(threadRewindRefusal("desktop", today, today), null);
  assert.equal(threadRewindRefusal("web_sidebar", today, today), null);

  assert.match(threadRewindRefusal("telegram", today, today), /delivered/);
  assert.match(threadRewindRefusal("whatsapp", today, today), /delivered/);
  assert.match(threadRewindRefusal("a2a", "andy~claude-code", today), /not rewound here/);
  assert.match(threadRewindRefusal("group", "g_123", today), /not rewound here/);
  assert.match(threadRewindRefusal("web", "2026-07-01", today), /only today/);
  // A person inside the day still names the day in its first ten characters.
  assert.equal(threadRewindRefusal("web", `${today}~owner`, today), null);
});

// ── The route ────────────────────────────────────────────────────────────────
// The store above is the mechanism; this is the only place that decides WHICH
// threads may use it. Mounted for real over express, against a sandboxed APX
// home, because the refusals are the whole point of the endpoint — a rewind
// that reaches the ledger on a Telegram thread is the bug this exists to stop.

const { default: express } = await import("express");
const { apiRouter } = await import("./_helpers.js");
const { register: registerConversations } = await import("../src/host/daemon/api/conversations.js");

const PROJECT = { id: 0, name: "default", path: TMP_HOME, storagePath: path.join(TMP_HOME, "storage") };

async function serve() {
  const app = express();
  app.use(express.json());
  const router = apiRouter(express, app);
  registerConversations(router, {
    projects: { list: () => [PROJECT], get: () => PROJECT, rebuild: () => {} },
    project: () => PROJECT,
    config: { model: "mock", engines: {}, super_agent: { name: "apx" } },
    plugins: {},
    registries: null,
  });
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const rewind = (base, channel, id, keep) =>
  fetch(`${base}/api/projects/0/super-agent/threads/${encodeURIComponent(channel)}/${encodeURIComponent(id)}/truncate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keep_visible: keep }),
  });

test("POST …/threads/:channel/:id/truncate — rewinds today's own-surface threads, refuses the rest", async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  // project_id "0" so the rows are in scope for the default workspace.
  const day = [
    { ts: `${today}T09:00:00Z`, channel: "web", direction: "in",  type: "user",  body: "dale", meta: { project_id: "0" } },
    { ts: `${today}T09:00:01Z`, channel: "web", direction: "out", type: "agent", agent_slug: "super_agent", body: "no", meta: { project_id: "0" } },
  ];
  writeDay(GLOBAL_MESSAGES_DIR, "web", today, day);
  writeDay(GLOBAL_MESSAGES_DIR, "telegram", today, day.map((r) => ({ ...r, channel: "telegram" })));

  const { server, base } = await serve();
  t.after(() => server.close());

  // Refused, and each one says which rule stopped it.
  for (const [channel, id, why] of [
    ["telegram", today, /delivered/],
    ["whatsapp", today, /delivered/],
    ["a2a", "magui~super_agent", /not rewound here/],
    ["group", "g_1", /not rewound here/],
    ["web", "2020-01-01", /only today/],
  ]) {
    const res = await rewind(base, channel, id, 1);
    assert.equal(res.status, 400, `${channel} ${id} must be refused`);
    assert.match((await res.json()).error, why);
  }
  // And the refusal is a refusal: Telegram's day is exactly as it was.
  assert.equal(readDay(GLOBAL_MESSAGES_DIR, "telegram", today).trim().split("\n").length, 2);

  // A bad count never reaches the ledger either.
  assert.equal((await rewind(base, "web", today, -1)).status, 400);
  assert.equal((await rewind(base, "web", today, "x")).status, 400);

  // Today's web thread: regenerating the answer keeps the question.
  const ok = await rewind(base, "web", today, 1);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, removed: 1 });
  assert.equal(readDay(GLOBAL_MESSAGES_DIR, "web", today).trim().split("\n").length, 1);
});
