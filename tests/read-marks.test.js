// "Read" belongs to the conversation, not to the browser that read it.
//
// THE BUG THIS EXISTS FOR. The panel kept read marks in `localStorage`, one
// copy per device. Manu read every chat on the laptop, picked up the phone, and
// found forty blue rows — every one of them already read, and no way to clear
// them except opening forty chats again. The badge had stopped meaning "there
// is something here" and started meaning "you have not held THIS device since
// it arrived".
//
// The contracts below are the ones that break silently if the store drifts:
//   · a mark is the agent's utterance (`preview_at`), never `last_activity_at`
//     — activity also moves for your own send and for every tool row of a turn,
//     so a watermark on it clears the dot the moment you press enter
//   · a fresh install takes a baseline (`seeded_at`), or the first request
//     announces every conversation the daemon has ever held
//   · a conversation that starts AFTER the baseline is unread — that is the row
//     most worth pointing at, and "no mark" must not be read as "read"
//   · a mark never moves backwards: two devices reading the same row in either
//     order leave the newer of the two standing
//   · the row's identity carries the PERSON, or Magui, Carlos and Manu share
//     one mark on WhatsApp and reading any of them reads all three
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// APX_HOME before the first #core import, or the store writes into the real
// ~/.apx — HOME alone is not enough (the runner pins its own APX_HOME).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-read-marks-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

const {
  readReadMarks,
  markRowsRead,
  isRowUnread,
  decorateUnread,
  readMarkKey,
  _resetReadMarksForTest,
} = await import("#core/stores/read-marks.js");
const { READ_MARKS_PATH } = await import("#core/config/paths.js");
const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { createTokenStore } = await import("#host/daemon/token-store.js");

const TOKEN = "master-read-marks";

function row(over = {}) {
  return {
    project_id: 7,
    agent_slug: "zoya",
    channel: "web",
    contact_person: null,
    preview_at: "2026-03-02T10:00:00Z",
    last_activity_at: "2026-03-02T10:05:00Z",
    ...over,
  };
}

test("the baseline is taken once, and everything before it is read", async () => {
  await _resetReadMarksForTest();
  const store = await readReadMarks();
  assert.match(store.seeded_at, /^\d{4}-\d{2}-\d{2}T/, "a real moment, not an empty string");
  assert.deepEqual(store.marks, {}, "a baseline is a stamp, not forty marks");
  assert.ok(fs.existsSync(READ_MARKS_PATH), "and it is pinned to disk, or the next request retakes it");

  // Said before the baseline: read. This is the whole migration — an install
  // that has been running for months must not light up on first sight.
  assert.equal(isRowUnread(row({ preview_at: "2020-01-01T00:00:00Z" }), store), false);

  // The stamp survives a second read: a baseline that moved would mark
  // everything read on every request.
  const again = await readReadMarks();
  assert.equal(again.seeded_at, store.seeded_at);
});

test("a conversation that starts after the baseline is unread", async () => {
  await _resetReadMarksForTest();
  const store = await readReadMarks();
  // No mark of its own, and the agent spoke after the baseline was taken.
  assert.equal(isRowUnread(row({ preview_at: "2999-01-01T00:00:00Z" }), store), true);
});

test("a row the agent has never answered on can never be unread", async () => {
  await _resetReadMarksForTest();
  const store = await readReadMarks();
  assert.equal(isRowUnread(row({ preview_at: null }), store), false);
  assert.equal(isRowUnread(row({ preview_at: "" }), store), false);
});

test("reading marks it read for everyone, and only up to what was read", async () => {
  await _resetReadMarksForTest();
  await readReadMarks();
  const said = "2999-01-01T00:00:00Z";
  assert.equal(await markRowsRead([{ ...row({ preview_at: said }), at: said }]), 1);

  const store = await readReadMarks();
  assert.equal(isRowUnread(row({ preview_at: said }), store), false);
  // An answer that landed AFTER the reader's copy was fetched has not been read
  // by anybody — marking the older utterance must not swallow it.
  assert.equal(isRowUnread(row({ preview_at: "2999-01-02T00:00:00Z" }), store), true);
});

test("a mark never moves backwards", async () => {
  await _resetReadMarksForTest();
  await readReadMarks();
  const newer = "2999-02-02T00:00:00Z";
  const older = "2999-01-01T00:00:00Z";
  await markRowsRead([{ ...row(), at: newer }]);
  // The phone had a stale list in hand and reports the older utterance.
  assert.equal(await markRowsRead([{ ...row(), at: older }]), 0, "nothing moved");
  const store = await readReadMarks();
  assert.equal(store.marks[readMarkKey(row())], newer);
});

test("the mark keys off what the AGENT said, not off activity", async () => {
  // last_activity_at also moves for your own send and for every tool row of a
  // turn. A store that keyed off it would clear the dot on enter.
  const src = fs.readFileSync(
    path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src/core/stores/read-marks.js"),
    "utf8",
  );
  const after = src.slice(src.indexOf("function stampOf"));
  assert.doesNotMatch(after, /last_activity_at/);
  assert.match(src, /row\?\.preview_at/);
});

test("two people on one channel are two rows, and two marks", async () => {
  await _resetReadMarksForTest();
  await readReadMarks();
  const magui = row({ agent_slug: "roby", channel: "whatsapp", contact_person: "magui", preview_at: "2999-01-01T00:00:00Z" });
  const carlos = { ...magui, contact_person: "carlos" };
  assert.notEqual(readMarkKey(magui), readMarkKey(carlos));

  await markRowsRead([{ ...magui, at: magui.preview_at }]);
  const store = await readReadMarks();
  assert.equal(isRowUnread(magui, store), false);
  assert.equal(isRowUnread(carlos, store), true, "reading one contact must not read the others");
});

test("decorateUnread stamps every row without touching the rest of it", async () => {
  await _resetReadMarksForTest();
  const store = await readReadMarks();
  const rows = [row({ preview_at: "2999-01-01T00:00:00Z" }), row({ agent_slug: "andy", preview_at: "2020-01-01T00:00:00Z" })];
  const out = decorateUnread(rows, store);
  assert.deepEqual(out.map((r) => r.unread), [true, false]);
  assert.equal(out[0].agent_slug, "zoya");
  assert.equal(out[0].last_activity_at, rows[0].last_activity_at);
});

// ── the route ──────────────────────────────────────────────────────────────

async function listen() {
  const projects = new ProjectManager({});
  projects.registerDefault();
  const app = buildApi({
    projects,
    registries: null,
    plugins: { status: () => ({}), get: () => null },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: TOKEN,
    tokenStore: createTokenStore({ masterToken: TOKEN }),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

const auth = { authorization: `Bearer ${TOKEN}` };

test("every inbox row carries the daemon's answer to `unread`", async () => {
  await _resetReadMarksForTest();
  const { server, baseUrl } = await listen();
  try {
    const res = await fetch(`${baseUrl}/api/inbox?include_empty=1`, { headers: auth });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.data));
    for (const r of body.data) {
      assert.equal(typeof r.unread, "boolean", `row ${r.agent_slug} must say whether it is unread`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("POST /inbox/read records the mark, and refuses a body that is not a list", async () => {
  await _resetReadMarksForTest();
  const { server, baseUrl } = await listen();
  try {
    const bad = await fetch(`${baseUrl}/api/inbox/read`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ rows: "everything" }),
    });
    assert.equal(bad.status, 400, "a malformed mark must not be silently accepted");

    const said = "2999-06-01T09:00:00Z";
    const ok = await fetch(`${baseUrl}/api/inbox/read`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ rows: [{ project_id: 7, agent_slug: "zoya", channel: "web", at: said }] }),
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).marked, 1);

    // And it is the SAME answer the next reader gets — the whole point.
    const store = await readReadMarks();
    assert.equal(isRowUnread(row({ preview_at: said }), store), false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
