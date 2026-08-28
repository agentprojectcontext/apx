// An a2a message can now be addressed to an external coding CLI, not only to an
// AGENTS.md agent — and the exchange has to behave like a conversation, which
// means the peer continues its OWN session instead of re-reading the thread
// every turn. These pin the three things that make that true:
//
//   1. addressing   — who a name resolves to, and how `:thread` splits two
//                     exchanges with the same peer
//   2. session args — each adapter opens, names and resumes its session
//   3. no re-reading — a resumed peer is NOT handed the transcript again
//
// (3) is the one worth guarding: dropping it costs nothing visible, and turns
// every turn into a full re-read of the conversation.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-peers-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { parsePeerAddress, resolvePeer, a2aSessionKey, refusesCodeMode } = await import("#core/agent/a2a/peers.js");
const { a2aReplyCommand, replyAsRuntime } = await import("#core/agent/a2a/reply.js");
const { readA2APeerSession } = await import("#core/stores/messages.js");
const claudeCode = (await import("#core/runtimes/claude-code.js")).default;
const codex = (await import("#core/runtimes/codex.js")).default;
const opencode = (await import("#core/runtimes/opencode.js")).default;

/**
 * A stand-in binary that APPENDS one JSON line per invocation. Appending is the
 * point: the opencode adapter spawns twice on a first turn (run, then a session
 * lookup), and a fake that overwrites would hide the call under test.
 */
async function withFakeBinary(name, body, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-peer-bin-"));
  const bin = path.join(dir, name);
  fs.writeFileSync(bin, body, { mode: 0o755 });
  fs.chmodSync(bin, 0o755);
  const argsFile = path.join(dir, "calls.jsonl");
  const oldPath = process.env.PATH || "";
  // Both on the real environment: replyAsRuntime hands the adapter no `env` (no
  // production caller has one to give), so the child inherits ours.
  process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  process.env.APX_FAKE_ARGS_FILE = argsFile;
  try {
    return await fn({
      env: { PATH: process.env.PATH, APX_FAKE_ARGS_FILE: argsFile },
      calls: () =>
        fs.existsSync(argsFile)
          ? fs.readFileSync(argsFile, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
          : [],
    });
  } finally {
    process.env.PATH = oldPath;
    delete process.env.APX_FAKE_ARGS_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const recorder = (emit) => `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.APX_FAKE_ARGS_FILE, JSON.stringify(args) + "\\n");
${emit}
`;

test("an address resolves to an agent, a runtime, or nothing at all", () => {
  assert.deepEqual(parsePeerAddress("opencode:review"), {
    address: "opencode:review",
    name: "opencode",
    thread: "review",
  });

  assert.equal(resolvePeer("opencode", []).kind, "runtime");
  assert.equal(resolvePeer("opencode:review", []).address, "opencode:review");
  assert.equal(resolvePeer("opencode:review", []).thread, "review");

  // A project that named an agent `codex` still owns that name.
  assert.equal(resolvePeer("codex", [{ slug: "codex" }]).kind, "agent");
  assert.equal(resolvePeer("andy:ops", [{ slug: "andy" }]).kind, "agent");
  assert.equal(resolvePeer("nobody", []), null);
});

test("both directions of one exchange name the same session", () => {
  assert.equal(
    a2aSessionKey("claude-code", "opencode"),
    a2aSessionKey("opencode", "claude-code"),
  );
  // A second thread with the same peer is a DIFFERENT session, or the two would
  // read each other's mail.
  assert.notEqual(
    a2aSessionKey("claude-code", "opencode"),
    a2aSessionKey("claude-code", "opencode:review"),
  );
});

test("the return address survives the shell", () => {
  assert.equal(
    a2aReplyCommand({ selfAddress: "opencode", peerAddress: "andy" }),
    'apx send opencode andy "<your message>" --deliver',
  );
  assert.match(
    a2aReplyCommand({ selfAddress: "opencode:review", peerAddress: "claude-code" }),
    /apx send "opencode:review" claude-code/,
  );
});

test("a thread suffix has to survive a URL, which is why it is not a #", () => {
  // The web opens a thread at /super-agent/threads/a2a/<pairId>. A `#` is a
  // fragment delimiter: the browser cuts the address before the request leaves
  // and every suffixed thread 404s. This is that regression, pinned.
  const addr = "opencode:review";
  assert.equal(parsePeerAddress(addr).thread, "review");
  assert.equal(new URL(`http://x/threads/a2a/${addr}~tester`).pathname.includes(addr), true);
  assert.equal(new URL("http://x/threads/a2a/opencode#review~tester").pathname.includes("review"), false);
});

test("the two CLIs the owner drives are never --code peers", () => {
  assert.equal(refusesCodeMode({ kind: "runtime", runtime: "claude-code" }), true);
  assert.equal(refusesCodeMode({ kind: "runtime", runtime: "codex" }), true);
  assert.equal(refusesCodeMode({ kind: "runtime", runtime: "opencode" }), false);
  // An AGENT named claude-code is a different thing and keeps its own rules.
  assert.equal(refusesCodeMode({ kind: "agent", agent: { slug: "claude-code" } }), false);
});

test("mode decides what the peer may touch, and read-only is the default", async () => {
  const emit = `process.stdout.write("ok\\n");`;
  const peer = { kind: "runtime", runtime: "opencode", address: "opencode", name: "opencode" };
  await withFakeBinary("opencode", recorder(emit), async ({ calls }) => {
    await replyAsRuntime({ peer, fromAddress: "andy", body: "hi", config: {}, cwd: process.cwd(), timeoutMs: 5000 });
    assert.deepEqual(calls()[0].slice(0, 3), ["run", "--agent", "plan"], "no mode given = read-only");
    assert.match(calls()[0].at(-1), /READ-ONLY/);

    await replyAsRuntime({ peer, fromAddress: "andy", body: "hi", config: {}, cwd: process.cwd(), timeoutMs: 5000, mode: "code" });
    // The last call is the session lookup the adapter makes after a run; the
    // one under test is the last `run`.
    const coding = calls().filter((c) => c[0] === "run").at(-1);
    assert.ok(!coding.includes("plan"), "a coding session is not opened in plan mode");
    assert.match(coding.at(-1), /CODING session/);
  });
});

test("codex opens a thread, then resumes it by id", async () => {
  const emit = `process.stdout.write(JSON.stringify({ type: "thread.started", thread_id: "th_1" }) + "\\n");
process.stdout.write(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "codex says hi" } }) + "\\n");`;

  await withFakeBinary("codex", recorder(emit), async ({ env, calls }) => {
    const first = await codex.run({ prompt: "ping", cwd: process.cwd(), env, timeoutMs: 5000 });
    assert.equal(first.sessionId, "th_1");
    assert.equal(first.output, "codex says hi");

    const second = await codex.run({
      prompt: "again",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      resumeSessionId: "th_1",
    });
    assert.equal(second.sessionId, "th_1");
    assert.deepEqual(calls()[1].slice(0, 3), ["exec", "resume", "th_1"]);
    // `exec resume` rejects --sandbox: it inherits the thread's own sandbox.
    assert.ok(!calls()[1].includes("--sandbox"));
  });
});

test("opencode names its session on the way in and reads the id back out", async () => {
  // The fake answers `session list` with a session titled whatever the earlier
  // `run` was given, which is exactly how the real lookup finds it.
  const emit = `if (args[0] === "session") {
  const prior = fs.readFileSync(process.env.APX_FAKE_ARGS_FILE, "utf8").trim().split("\\n").map(JSON.parse);
  const run = prior.find((a) => a[0] === "run");
  const title = run[run.indexOf("--title") + 1];
  process.stdout.write(JSON.stringify([{ id: "ses_fake", title, updated: 2, directory: process.cwd() }]));
} else {
  process.stdout.write("opencode answer\\n");
}`;

  await withFakeBinary("opencode", recorder(emit), async ({ env, calls }) => {
    const first = await opencode.run({
      prompt: "ping",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      sessionKey: "apx-a2a:andy~opencode",
    });
    assert.equal(first.sessionId, "ses_fake");
    assert.deepEqual(calls()[0].slice(0, 3), ["run", "--title", "apx-a2a:andy~opencode"]);
    assert.equal(calls()[1][0], "session", "first turn looks the new session up");

    const second = await opencode.run({
      prompt: "again",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      sessionKey: "apx-a2a:andy~opencode",
      resumeSessionId: "ses_fake",
    });
    assert.equal(second.sessionId, "ses_fake");
    assert.deepEqual(calls()[2].slice(0, 3), ["run", "--session", "ses_fake"]);
    // Resuming already knows the id — a second lookup would be a wasted spawn.
    assert.equal(calls().length, 3);
  });
});

test("claude code resumes the session it reported", async () => {
  const emit = `process.stdout.write(JSON.stringify({ result: "claude says hi", session_id: "sess-9" }));`;
  await withFakeBinary("claude", recorder(emit), async ({ env, calls }) => {
    const first = await claudeCode.run({ prompt: "ping", cwd: process.cwd(), env, timeoutMs: 5000 });
    assert.equal(first.sessionId, "sess-9");

    await claudeCode.run({
      prompt: "again",
      cwd: process.cwd(),
      env,
      timeoutMs: 5000,
      resumeSessionId: "sess-9",
    });
    const resumed = calls()[1];
    assert.deepEqual(resumed.slice(resumed.indexOf("--resume"), resumed.indexOf("--resume") + 2), [
      "--resume",
      "sess-9",
    ]);
  });
});

test("a resumed peer is not handed the transcript again", async () => {
  const emit = `process.stdout.write("ok\\n");`;
  const history = [
    { role: "user", content: "From andy:\n\nfirst question" },
    { role: "assistant", content: "first answer" },
  ];
  const peer = { kind: "runtime", runtime: "opencode", address: "opencode", name: "opencode" };

  await withFakeBinary("opencode", recorder(emit), async ({ calls }) => {
    // No session on record: the thread has to travel in the prompt, or the peer
    // answers a follow-up it never saw the start of.
    await replyAsRuntime({
      peer,
      fromAddress: "andy",
      body: "second question",
      config: {},
      history,
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    const cold = calls()[0].at(-1);
    assert.match(cold, /Earlier in this exchange/);
    assert.match(cold, /first answer/);

    // Resuming: the peer already lived through those turns. Replaying them
    // would have it read its own words back as new input.
    await replyAsRuntime({
      peer,
      fromAddress: "andy",
      body: "third question",
      config: {},
      history,
      cwd: process.cwd(),
      resumeSessionId: "ses_x",
      timeoutMs: 5000,
    });
    const warm = calls().at(-1).at(-1);
    assert.doesNotMatch(warm, /Earlier in this exchange/);
    assert.doesNotMatch(warm, /first answer/);
    assert.match(warm, /third question/);
  });
});

test("every peer is told its output is the reply, and not to send it twice", async () => {
  const emit = `process.stdout.write("ok\\n");`;
  const peer = { kind: "runtime", runtime: "opencode", address: "opencode", name: "opencode" };
  await withFakeBinary("opencode", recorder(emit), async ({ calls }) => {
    await replyAsRuntime({
      peer,
      fromAddress: "andy",
      body: "hello",
      config: {},
      cwd: process.cwd(),
      timeoutMs: 5000,
    });
    const prompt = calls()[0].at(-1);
    assert.match(prompt, /Your output IS the reply/);
    assert.match(prompt, /files it twice/);
    // …and the return address, so a follow-up knows where to go.
    assert.match(prompt, /apx send opencode andy/);
  });
});

test("each peer's session is its own, even though the two share one thread", () => {
  // An a2a thread is keyed by the UNORDERED pair, so claude-code→opencode and
  // opencode→claude-code are the same thread — and it holds a session per peer.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apx-peer-ledger-"));
  const dir = path.join(root, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    // opencode answered claude-code, and kept an opencode session.
    { ts: "2026-08-28T10:00:00Z", channel: "a2a", direction: "out", type: "agent",
      author: "opencode", agent_slug: "opencode", body: "sure",
      meta: { to: "claude-code", runtime: "opencode", runtime_session_id: "ses_oc" } },
    // Later, claude-code answered opencode, and kept a CLAUDE session.
    { ts: "2026-08-28T11:00:00Z", channel: "a2a", direction: "out", type: "agent",
      author: "claude-code", agent_slug: "claude-code", body: "on it",
      meta: { to: "opencode", runtime: "claude-code", runtime_session_id: "uuid-cc" } },
  ];
  fs.writeFileSync(path.join(dir, "2026-08-28.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  // Taking "the newest session on the thread" would hand claude's uuid to
  // opencode, which rejects it outright ("Session not found").
  assert.equal(readA2APeerSession(root, { from: "claude-code", to: "opencode" }), "ses_oc");
  assert.equal(readA2APeerSession(root, { from: "opencode", to: "claude-code" }), "uuid-cc");
  // A peer with no session yet is a first turn, not an error.
  assert.equal(readA2APeerSession(root, { from: "claude-code", to: "codex" }), null);
  fs.rmSync(root, { recursive: true, force: true });
});
