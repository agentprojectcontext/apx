// `apx send --deliver` and the difference between "not sent" and "sent, reply lost".
//
// THE FAILURE THIS FIXES, from a real install (2026-09-07): five
// `apx send claude magui "…" --deliver` in a row, four of them ended with
// `apx: fetch failed`. All five had been delivered and magui answered all five
// — the replies were on the thread 2 to 7 minutes later. The cause is a dead
// heat: the daemon's budget for a delivered turn is 300 s and undici's
// headersTimeout is the same 300 s, so a peer that uses its whole budget loses
// the race by a hair. Believing the error, the sender retyped the same long
// message, and it landed on the thread five times.
//
// So: a call that is willing to wait longer than fetch will, a dropped socket
// tagged as a transport failure rather than a refusal, and — when it does drop
// — the ledger read back to say which of the two things happened.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeHttp from "node:http";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-send-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");
fs.mkdirSync(process.env.APX_HOME, { recursive: true });

// A stand-in daemon. Routes are set per test; /api/health always answers so the
// client's ping() succeeds and it never tries to spawn a real daemon.
const routes = {};
const server = nodeHttp.createServer(async (req, res) => {
  const url = req.url.split("?")[0];
  if (url === "/api/health") return res.end(JSON.stringify({ status: "ok" }));
  const handler = routes[url];
  if (!handler) { res.statusCode = 404; return res.end(JSON.stringify({ error: "no route" })); }
  await handler(req, res);
});

// Top level, NOT in before(): http.js reads the port at module load, and the
// dynamic imports below run before any hook would. Getting this wrong pointed
// the whole file at the real daemon on 7430.
await new Promise((r) => server.listen(0, "127.0.0.1", r));
process.env.APX_PORT = String(server.address().port);
process.env.APX_HOST = "127.0.0.1";
after(() => server.close());

const { http } = await import("#interfaces/cli/http.js").catch(() => import("../src/interfaces/cli/http.js"));
const { readBackSend, awaitReplyOnThread } = await import("../src/interfaces/cli/commands/a2a.js");

const MSGS = "/api/projects/7/messages";
const serveRows = (rows) => { routes[MSGS] = (_req, res) => res.end(JSON.stringify(rows)); };

test("a call that says how long it will wait outlives fetch's ceiling", async () => {
  routes["/api/slow"] = (_req, res) => setTimeout(() => res.end(JSON.stringify({ ok: true })), 300);
  const r = await http.post("/api/slow", { x: 1 }, { timeoutMs: 5000 });
  assert.deepEqual(r, { ok: true });
});

test("a dropped socket is tagged transport, not confused with a refusal", async () => {
  routes["/api/hang"] = () => { /* never answers */ };
  const e = await http.post("/api/hang", {}, { timeoutMs: 300 }).then(() => null, (err) => err);
  assert.ok(e, "expected a failure");
  assert.equal(e.transport, true, "a dropped socket has to be distinguishable from a 400");
  assert.match(e.message, /no reply from the daemon after/);
});

test("a refusal from the daemon is NOT a transport failure", async () => {
  routes["/api/no"] = (_req, res) => { res.statusCode = 400; res.end(JSON.stringify({ error: "agent not found" })); };
  const e = await http.post("/api/no", {}, { timeoutMs: 5000 }).then(() => null, (err) => err);
  assert.equal(e.message, "agent not found");
  assert.ok(!e.transport, "a 400 says what happened — it must reach the user unchanged");
  assert.equal(e.status, 400);
});

const SENT = "Dos cosas, Magui. Las voces hay que rehacerlas con Gemini y ojo con tu memoria.";

test("the ledger says the message was never logged — safe to resend", async () => {
  serveRows([{ ts: "2026-09-07T18:00:00Z", author: "otro", direction: "out", body: "algo más" }]);
  const seen = await readBackSend({ pid: 7, from: "claude", to: "magui", body: SENT, since: "2026-09-07T17:59:50Z" });
  assert.equal(seen.logged, false);
  assert.equal(seen.reply, null);
});

test("the ledger says it WAS logged and the peer has answered", async () => {
  serveRows([
    { ts: "2026-09-07T18:00:06Z", author: "claude", direction: "out", body: SENT },
    { ts: "2026-09-07T18:01:06Z", author: "magui", direction: "out", body: "Tenés razón en las dos cosas.", meta: { final: true } },
  ]);
  const seen = await readBackSend({ pid: 7, from: "claude", to: "magui", body: SENT, since: "2026-09-07T17:59:50Z" });
  assert.equal(seen.logged, true);
  assert.equal(seen.sent_ts, "2026-09-07T18:00:06Z");
  assert.match(seen.reply.body, /Tenés razón/);
});

test("logged, but the peer is still working — no reply yet, and that is not a failure", async () => {
  serveRows([{ ts: "2026-09-07T18:00:06Z", author: "claude", direction: "out", body: SENT }]);
  const seen = await readBackSend({ pid: 7, from: "claude", to: "magui", body: SENT, since: "2026-09-07T17:59:50Z" });
  assert.equal(seen.logged, true);
  assert.equal(seen.reply, null);
});

test("a non-final row from the peer is not mistaken for the reply", async () => {
  serveRows([
    { ts: "2026-09-07T18:00:06Z", author: "claude", direction: "out", body: SENT },
    { ts: "2026-09-07T18:00:30Z", author: "magui", direction: "in", body: SENT },
  ]);
  const seen = await readBackSend({ pid: 7, from: "claude", to: "magui", body: SENT, since: "2026-09-07T17:59:50Z" });
  assert.equal(seen.reply, null, "the echoed inbound copy is not an answer");
});

test("the daemon itself unreachable: claim nothing", async () => {
  delete routes[MSGS];
  const seen = await readBackSend({ pid: 7, from: "claude", to: "magui", body: SENT, since: "2026-09-07T17:59:50Z" });
  assert.equal(seen.logged, null, "unknown must not be reported as 'not sent'");
});

test("waiting for the reply gives up on a deadline instead of hanging", async () => {
  serveRows([{ ts: "2026-09-07T18:00:06Z", author: "claude", direction: "out", body: SENT }]);
  const t0 = Date.now();
  const done = await awaitReplyOnThread({
    pid: 7, from: "claude", to: "magui", body: SENT,
    since: "2026-09-07T17:59:50Z", deadline: Date.now() + 50,
  });
  assert.equal(done.reply, null);
  assert.ok(Date.now() - t0 < 4000, "must not sleep a full poll interval past the deadline");
});
