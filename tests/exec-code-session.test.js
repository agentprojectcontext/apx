// `apx exec --code` used to post to the stateless /super-agent/chat/stream
// route. The turn ran, printed, and vanished: nothing was persisted, so the web
// Code module had nothing to list, and asked "which session did it go to?" the
// honest answer was "none". It now opens (or continues) a real code session, so
// the turn is readable at /m/code afterwards.
//
// Driven end to end: the real CLI binary against a stub daemon on a throwaway
// port. The fix is about WHICH route the CLI calls and WHAT it tells the caller,
// and only a real process proves both — a stubbed stdout would also swallow the
// test reporter's own output.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";

const execFileAsync = promisify(execFile);

/** execFile, but a non-zero exit is a result to assert on, not a throw. */
async function runAllowingFailure(cmd, argv, opts) {
  try {
    const r = await execFileAsync(cmd, argv, opts);
    return { ...r, code: 0 };
  } catch (e) {
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", code: e.code ?? 1 };
  }
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "interfaces", "cli", "index.js");

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-exec-code-"));

let server;
let port;
/** Every request the stub daemon saw, in order. Reset by apx(). */
let seen = [];

before(async () => {
  port = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port: p } = s.address();
      s.close(() => resolve(p));
    });
  });

  const app = express();
  app.use(express.json());

  // Answering health keeps the CLI from trying to spawn a real daemon.
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/projects", (_req, res) =>
    res.json([{ id: 0, name: "acme", path: TMP_HOME }])
  );
  app.get("/api/code/sessions", (_req, res) => res.json({ sessions: [] }));

  app.post("/api/projects/:pid/code/sessions", (req, res) => {
    seen.push({ route: "create", pid: req.params.pid, body: req.body });
    res.status(201).json({ id: "cs_stub01", title: req.body?.title, messages: [] });
  });

  // Failure stubs first — see the ordering note on the generic route below.
  // A turn that dies inside the daemon: NDJSON `error` event, no `final`.
  app.post("/api/projects/:pid/code/sessions/fail_ev/chat/stream", (req, res) => {
    seen.push({ route: "stream", sid: "fail_ev", body: req.body });
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.write(JSON.stringify({ type: "model_start", model: "mock" }) + "\n");
    res.write(JSON.stringify({ type: "error", error: "engine unreachable" }) + "\n");
    res.end();
  });

  // The same, as a TRAILING line with no newline — the shape the bare
  // `catch {}` in streamRequest used to swallow whole.
  app.post("/api/projects/:pid/code/sessions/fail_raw/chat/stream", (req, res) => {
    seen.push({ route: "stream", sid: "fail_raw", body: req.body });
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.write(JSON.stringify({ type: "model_start", model: "mock" }) + "\n");
    res.write(JSON.stringify({ type: "error", error: "engine unreachable" }));
    res.end();
  });

  // A stream that just stops: no reply, no error, clean close.
  app.post("/api/projects/:pid/code/sessions/silent/chat/stream", (req, res) => {
    seen.push({ route: "stream", sid: "silent", body: req.body });
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.write(JSON.stringify({ type: "model_start", model: "mock" }) + "\n");
    res.end();
  });

  // Registered LAST of the session routes: `:sid` is a wildcard and would
  // otherwise swallow the specific failure stubs above.
  app.post("/api/projects/:pid/code/sessions/:sid/chat/stream", (req, res) => {
    seen.push({ route: "stream", pid: req.params.pid, sid: req.params.sid, body: req.body });
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.write(JSON.stringify({ type: "model_start", model: "mock" }) + "\n");
    res.write(
      JSON.stringify({
        type: "final",
        result: { text: "done", name: "apx", usage: { input_tokens: 1, output_tokens: 2 } },
      }) + "\n"
    );
    res.end();
  });

  // The route the fix moves OFF of. Recorded so a regression is loud.
  app.post("/api/projects/:pid/super-agent/chat/stream", (req, res) => {
    seen.push({ route: "super-agent", pid: req.params.pid, body: req.body });
    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.write(JSON.stringify({ type: "final", result: { text: "stateless" } }) + "\n");
    res.end();
  });

  // Anything unexpected is a routing bug, not a 404 to shrug at.
  app.use((req, res) => {
    seen.push({ route: `UNEXPECTED ${req.method} ${req.path}` });
    res.status(404).json({ error: "not stubbed" });
  });

  server = await new Promise((r) => {
    const s = app.listen(port, "127.0.0.1", () => r(s));
  });
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

/** Run the real CLI against the stub daemon; returns { stdout, stderr, seen }. */
async function apx(...argv) {
  seen = [];
  const { stdout, stderr, code } = await runAllowingFailure(process.execPath, [CLI, ...argv], {
    cwd: ROOT,
    env: {
      ...process.env,
      HOME: TMP_HOME,
      APX_HOME: path.join(TMP_HOME, ".apx"),
      APX_PORT: String(port),
      APX_HOST: "127.0.0.1",
      APX_NO_SPINNER: "1",
      NO_COLOR: "1",
    },
  });
  return { stdout, stderr, code, seen: [...seen] };
}

test("--code opens a code session and streams the turn into it", async () => {
  const r = await apx("exec", "--code", "--project", "0", "refactor the auth middleware");

  const routes = r.seen.map((s) => s.route);
  assert.deepEqual(routes, ["create", "stream"], "a session is created, then driven");

  const [create, stream] = r.seen;
  assert.equal(create.body.title, "refactor the auth middleware", "titled from the prompt");
  assert.equal(stream.sid, "cs_stub01");
  assert.equal(stream.body.prompt, "refactor the auth middleware");
  assert.equal(stream.body.channel, "code", "prompted as the terminal surface it came from");
  assert.equal(stream.body.cwd, ROOT, "the caller's cwd rides along");
  assert.equal(stream.body.confirm, false, "the CLI cannot answer a confirmation round-trip");
});

test("the reply goes to stdout and the session id to stderr", async () => {
  const r = await apx("exec", "--code", "--project", "0", "hello");
  // The CLI prints a version mark on stderr; stdout is the answer alone.
  assert.equal(r.stdout.trim(), "done", "stdout stays the answer alone, for scripts");
  assert.match(r.stderr, /cs_stub01/, "the caller must be told which session it landed in");
  assert.match(r.stderr, /\/m\/code/, "and where to read it");
});

test("--session continues an existing session instead of opening another", async () => {
  const r = await apx(
    "exec", "--code", "--project", "0", "--session", "cs_prior9", "and now a test"
  );
  assert.deepEqual(r.seen.map((s) => s.route), ["stream"], "no second session is created");
  assert.equal(r.seen[0].sid, "cs_prior9");
  assert.doesNotMatch(r.stderr, /\(new\)/);
});

test("without --code the stateless super-agent route is unchanged", async () => {
  const r = await apx("exec", "--project", "0", "what time is it");
  assert.deepEqual(r.seen.map((s) => s.route), ["super-agent"]);
  assert.equal(r.seen[0].body.channel, "cli");
});

test("--channel code takes the same path as --code", async () => {
  const r = await apx("exec", "--channel", "code", "--project", "0", "same surface");
  assert.deepEqual(r.seen.map((s) => s.route), ["create", "stream"]);
});

test("codeSessionTitle: the session list has to be readable at a glance", async () => {
  const { codeSessionTitle } = await import("#interfaces/cli/commands/exec.js");
  assert.equal(codeSessionTitle("Fix the login redirect"), "Fix the login redirect");
  // Collapsed whitespace — a pasted multi-line prompt must not break the row.
  assert.equal(codeSessionTitle("  Fix  the\n  redirect  "), "Fix the redirect");
  // First sentence when that alone is short enough to name the task.
  assert.equal(
    codeSessionTitle("Add a test. Then run the suite and report what fails."),
    "Add a test."
  );
  // Otherwise truncated, never a wall of text.
  const long = codeSessionTitle("x".repeat(200));
  assert.ok(long.length <= 60, `title too long: ${long.length}`);
  assert.match(long, /…$/);
  // Never empty: an untitled row is a row you cannot pick out.
  assert.equal(codeSessionTitle("   "), "Code");
});

// A turn that fails must SAY so. `streamRequest` used to break out of its read
// loop silently and wrap the trailing line in a bare `catch {}`, so a daemon
// that reported "engine unreachable" reached the user as a blank line and exit
// 0 — indistinguishable from a successful empty answer, and the reason a failed
// `--code` run looked like it had simply gone missing.
for (const [sid, label] of [
  ["fail_ev", "an error event"],
  ["fail_raw", "an error event with no trailing newline"],
]) {
  test(`${label} surfaces as a real failure, not a blank line`, async () => {
    const r = await apx("exec", "--code", "--project", "0", "--session", sid, "do a thing");
    assert.notEqual(r.code, 0, "a failed turn must not exit 0");
    assert.match(r.stderr, /engine unreachable/, "the daemon's reason must reach the user");
    assert.equal(r.stdout.trim(), "", "nothing is claimed as an answer");
    // Even on failure, name the session: the user turn is stored there.
    assert.match(r.stderr, new RegExp(sid));
  });
}

test("a turn that ends with no reply is reported, not printed as empty", async () => {
  const r = await apx("exec", "--code", "--project", "0", "--session", "silent", "do a thing");
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /without a reply/);
  assert.match(r.stderr, /silent/, "and it names the session holding the transcript");
});
