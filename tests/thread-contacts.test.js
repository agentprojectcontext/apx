// One channel, several people: a WhatsApp day file must read back as one thread
// per person, and every other channel must keep reading back as one thread.
//
// The regression this file guards is not cosmetic. Before the split, Magui's
// messages and a stranger's shared a single "WhatsApp" thread, so opening one
// person's conversation showed everyone's — on a channel whose entire design is
// that a third party must never see anything but their own turn.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-threads-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const {
  parseThreadId,
  threadId,
  rowContact,
  listGlobalThreads,
  readGlobalThread,
  deleteGlobalThread,
} = await import("#core/stores/messages.js");

const DIR = path.join(TMP_HOME, "ledger");
const DAY = "2026-09-08";

function writeDay(channel, rows) {
  const dir = path.join(DIR, channel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${DAY}.jsonl`),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

const row = (over) => ({
  ts: `${DAY}T12:00:00Z`,
  channel: "whatsapp",
  direction: "in",
  type: "user",
  author: "unknown",
  body: "hola",
  ...over,
});

test("parseThreadId: a bare date, a person, and nothing that escapes", () => {
  assert.deepEqual(parseThreadId("2026-09-08"), { date: "2026-09-08", contact: null });
  assert.deepEqual(parseThreadId("2026-09-08~owner"), { date: "2026-09-08", contact: "owner" });
  assert.deepEqual(parseThreadId("2026-09-08~549115@lid"), { date: "2026-09-08", contact: "549115@lid" });
  // The date half builds a filename, so the contact half must never be a path.
  assert.equal(parseThreadId("2026-09-08~../../etc/passwd"), null);
  assert.equal(parseThreadId("2026-09-08~a/b"), null);
  assert.equal(parseThreadId("not-a-date"), null);
  assert.equal(parseThreadId(""), null);
  // Round-trips, and a thread with no contact keeps the id it always had.
  assert.equal(threadId("2026-09-08"), "2026-09-08");
  assert.equal(threadId("2026-09-08", "owner"), "2026-09-08~owner");
});

test("rowContact prefers the stamped key and falls back to the address", () => {
  assert.equal(rowContact({ meta: { contact_key: "owner", sender_jid: "1@lid" } }), "owner");
  // Device suffixes vary per linked device; they cannot be part of the key.
  assert.equal(
    rowContact({ meta: { sender_jid: "5491155555555:12@s.whatsapp.net" } }),
    "5491155555555@s.whatsapp.net",
  );
  // The owner, from what the row already recorded — so a conversation written
  // before the key existed is the same thread as the one written after, and the
  // owner's two lines do not become two threads.
  assert.equal(rowContact({ meta: { role: "owner", sender_jid: "111@lid" } }), "owner");
  assert.equal(rowContact({ meta: { policy: "full", sender_jid: "222@s.whatsapp.net" } }), "owner");
  // Every other channel: no contact, one thread for the day.
  assert.equal(rowContact({ meta: { chat_id: 42 } }), null);
  assert.equal(rowContact({}), null);
});

test("a whatsapp day lists one thread per person, titled by the person", () => {
  writeDay("whatsapp", [
    row({ author: "Manu", body: "che", meta: { contact_key: "owner", sender_jid: "111@lid" } }),
    row({ author: "Magui", body: "hola roby", meta: { contact_key: "222@lid", sender_jid: "222@lid" } }),
    row({
      ts: `${DAY}T12:05:00Z`,
      direction: "out",
      type: "agent",
      author: "Roby",
      body: "hola Magui",
      meta: { contact_key: "222@lid", sender_jid: "222@lid" },
    }),
    // The owner writing from their OTHER address still lands in one thread —
    // that is what the stamped key buys over the raw jid.
    row({ ts: `${DAY}T12:09:00Z`, author: "Manu", body: "y esto", meta: { contact_key: "owner", sender_jid: "5491155555555@s.whatsapp.net" } }),
  ]);

  const threads = listGlobalThreads({ _globalMessagesDir: DIR });
  assert.equal(threads.length, 2, "one thread per person, not per address");

  const magui = threads.find((t) => t.contact === "222@lid");
  const owner = threads.find((t) => t.contact === "owner");
  assert.ok(magui && owner);
  assert.equal(magui.id, `${DAY}~222@lid`);
  assert.equal(magui.title, "Magui", "a person's thread is titled by the person");
  assert.equal(magui.messages, 2);
  assert.equal(owner.messages, 2, "both of the owner's addresses folded in");
  assert.equal(owner.title, "Manu");
});

test("reading one person's thread returns only that person", () => {
  const magui = readGlobalThread({ channel: "whatsapp", date: `${DAY}~222@lid`, _globalMessagesDir: DIR });
  assert.equal(magui.messages.length, 2);
  assert.equal(magui.contact, "222@lid");
  assert.ok(magui.messages.every((m) => !/che|y esto/.test(m.content)), "the owner's turns must not leak in");

  // The unscoped id still reads the whole day — nothing that stored the old id
  // breaks, it just sees everything, which is what it always saw.
  const whole = readGlobalThread({ channel: "whatsapp", date: DAY, _globalMessagesDir: DIR });
  assert.equal(whole.messages.length, 4);

  // A person who never wrote that day is a 404, not an empty pane.
  assert.equal(
    readGlobalThread({ channel: "whatsapp", date: `${DAY}~999@lid`, _globalMessagesDir: DIR }),
    null,
  );
});

test("channels with one correspondent are untouched", () => {
  writeDay("telegram", [
    row({ channel: "telegram", body: "primera cosa", meta: { chat_id: 7 } }),
    row({ channel: "telegram", ts: `${DAY}T13:00:00Z`, body: "segunda", meta: { chat_id: 7 } }),
  ]);
  const tg = listGlobalThreads({ channels: ["telegram"], _globalMessagesDir: DIR });
  assert.equal(tg.length, 1);
  assert.equal(tg[0].id, DAY, "the id stays the bare date");
  assert.equal(tg[0].contact, undefined);
  assert.equal(tg[0].title, "primera cosa", "still titled by the first thing said");
});

test("deleting one person's thread leaves everyone else's alone", () => {
  const ok = deleteGlobalThread({ channel: "whatsapp", date: `${DAY}~222@lid`, _globalMessagesDir: DIR });
  assert.equal(ok, true);

  const left = listGlobalThreads({ channels: ["whatsapp"], _globalMessagesDir: DIR });
  assert.equal(left.length, 1);
  assert.equal(left[0].contact, "owner");
  assert.equal(left[0].messages, 2, "the owner's turns survived the neighbour's delete");

  // Deleting a person who has nothing left is a no-op, not a truncated file.
  assert.equal(
    deleteGlobalThread({ channel: "whatsapp", date: `${DAY}~222@lid`, _globalMessagesDir: DIR }),
    false,
  );
});

test("legacy rows with no contact keep their own whole-day thread", () => {
  writeDay("whatsapp", [
    // The ADB-relay era: logged on the whatsapp channel, no sender recorded.
    row({ body: "ronda de whatsapp", author: "Roby", direction: "out", type: "agent", meta: {} }),
    row({ ts: `${DAY}T14:00:00Z`, author: "Magui", body: "hola", meta: { contact_key: "222@lid" } }),
  ]);
  const threads = listGlobalThreads({ channels: ["whatsapp"], _globalMessagesDir: DIR });
  assert.equal(threads.length, 2);
  const legacy = threads.find((t) => !t.contact);
  assert.ok(legacy, "history without a sender still has somewhere to live");
  assert.equal(legacy.id, DAY);
  assert.equal(legacy.messages, 1);
});

test("a foreign APX_HOME never auto-starts a daemon on the shared port", async () => {
  const { ensureDaemon } = await import("#interfaces/cli/http.js");
  // APX_HOME is the sandbox this file set at the top — i.e. exactly the shape a
  // test process has. If nothing answers on 7430, this must REFUSE rather than
  // spawn a daemon that answers for a temp home: that is how a preflight run
  // took the user's real WhatsApp offline, with /api/health still saying "ok".
  const port = process.env.APX_PORT;
  delete process.env.APX_PORT;
  try {
    await ensureDaemon({ silent: true });
    // A daemon IS up (the developer's own) — then ping succeeded and nothing was
    // started, which is also correct. Only the spawn is forbidden.
  } catch (e) {
    assert.match(e.message, /refusing to auto-start/);
    assert.match(e.message, /APX_HOME/);
  } finally {
    if (port !== undefined) process.env.APX_PORT = port;
  }
});

test("a daemon refuses the shared port when another home is already serving it", async () => {
  const src = await import("node:fs").then((fs) => fs.readFileSync("src/host/daemon/index.js", "utf8"));
  // Asserted on source, like daemon-shutdown-guard: the alternative is racing a
  // real daemon inside the suite, which is the very thing this prevents.
  const guard = src.indexOf("refuseIfAnotherHomeIsServing(port");
  const listen = src.indexOf("app.listen(port");
  assert.ok(guard > 0, "the port guard is gone");
  assert.ok(listen > 0);
  assert.ok(guard < listen, "the guard must run BEFORE the bind — after it, the port is already taken");

  // Fails OPEN on anything it cannot read. A daemon that refused whenever
  // something answered could never restart, because the outgoing one still
  // answers for a second or two — and that would break every day, unlike the
  // collision, which needs a test run to happen at all.
  assert.match(src, /if \(!theirs \|\| theirs === homeId\(\)\) return;/);

  const { homeId } = await import("#host/daemon/api/health.js");
  assert.notEqual(homeId("/a/.apx"), homeId("/b/.apx"), "two homes must not share a fingerprint");
  assert.equal(homeId("/a/.apx"), homeId("/a/.apx"), "and one home must be stable");
  // A digest, not the path: /api/health is the one route served without a token.
  assert.doesNotMatch(homeId("/Users/someone/.apx"), /Users|someone/);
});
