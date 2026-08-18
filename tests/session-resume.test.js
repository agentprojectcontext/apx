// Reopening a session in the CLI that owns it.
//
// The failure this guards against is silent: a wrong resume command doesn't
// error, it starts a BRAND NEW session, and the user only notices when the
// history they came back for isn't there. So the command each engine needs is
// pinned here, along with the OpenCode listing — the one engine APX can't read
// from disk, and therefore the one whose parsing can rot without anyone
// noticing until the list turns up empty.

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import {
  parseOpencodeSessionList,
  parseOpencodeUpdated,
  resumeArgvFor,
  resumeCommandFor,
} from "#core/sessions/index.js";
import { resolveTerminalTarget } from "#host/daemon/terminal-ws.js";

test("each engine gets the command that re-enters a session, not a new one", () => {
  assert.deepEqual(resumeArgvFor("claude", "abc-123"), ["claude", "--resume", "abc-123"]);
  assert.deepEqual(resumeArgvFor("codex", "01a0"), ["codex", "resume", "01a0"]);
  assert.deepEqual(resumeArgvFor("opencode", "ses_x1"), ["opencode", "--session", "ses_x1"]);
  assert.deepEqual(resumeArgvFor("apx", "2026-08-18-03"), ["apx", "session", "resume", "2026-08-18-03"]);
});

test("an engine that cannot reopen a session says so instead of guessing", () => {
  assert.equal(resumeArgvFor("antigravity", "x"), null);
  assert.equal(resumeArgvFor("nope", "x"), null);
  assert.equal(resumeCommandFor("claude", ""), null);
});

test("the copyable command quotes only what the shell would mangle", () => {
  assert.equal(resumeCommandFor("claude", "abc-123"), "claude --resume abc-123");
  // An id is engine-generated, but the quoting is what stands between a shell
  // and anything odd that ends up in one.
  assert.equal(resumeCommandFor("claude", "a b"), "claude --resume 'a b'");
});

test("opencode's session table parses into rows", () => {
  const stdout = [
    "Session ID                      Title                                               Updated",
    "──────────────────────────────────────────────────────────────────────────────────────────",
    "ses_fea172c1dffev3WPRE1tKMCKNb  Diseño de contexto unificado para APX               2:26 PM",
    "ses_0c7062b27ffesYUvlpxpxVYnc0  New session - 2026-07-06T19:48:44.888Z              4:48 PM · 7/6/2026",
  ].join("\n");
  const now = Date.UTC(2026, 7, 18, 12, 0, 0);
  const rows = parseOpencodeSessionList(stdout, now);

  assert.equal(rows.length, 2, "the header and its rule are not sessions");
  assert.equal(rows[0].id, "ses_fea172c1dffev3WPRE1tKMCKNb");
  assert.equal(rows[0].title, "Diseño de contexto unificado para APX");
  assert.ok(rows[0].mtime > 0);
  assert.equal(new Date(rows[1].mtime).getFullYear(), 2026);
});

test("an unreadable timestamp costs the row its place in the order, not its listing", () => {
  const rows = parseOpencodeSessionList("ses_abc  Some title  hace un rato");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mtime, 0);
  assert.equal(parseOpencodeUpdated("14:26"), 0, "24h clocks are not the format we know");
  assert.equal(parseOpencodeUpdated(""), 0);
});

test("the terminal refuses a session it cannot reopen instead of opening a shell", () => {
  const target = (qs) => resolveTerminalTarget(new URLSearchParams(qs), { home: os.tmpdir() });

  assert.match(target("").problem, /no session id/);
  assert.match(target("id=x&engine=antigravity").problem, /cannot reopen/);

  // A known engine builds the command even when the session isn't on disk yet:
  // the engine is what decides the verb, and the id is the user's to supply.
  const ok = target("id=ses_abc&engine=opencode");
  assert.equal(ok.problem, undefined);
  assert.deepEqual(ok.argv, ["opencode", "--session", "ses_abc"]);
  assert.equal(ok.cwd, os.tmpdir(), "an unknown working directory falls back to home");
});
