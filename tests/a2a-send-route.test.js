// POST /projects/:pid/send — the routing decisions a runtime peer added, at the
// layer that makes them: who may be addressed, who may be handed write access,
// whether the caller waits, and where a coding exchange shows up afterwards.
//
// The peer here is a fake `opencode` on PATH, so these exercise the real route
// end to end — resolution, spawn, ledger, Code-module mirror — without a model
// call or a real CLI.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-send-route-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { listCodeSessions } = await import("#core/stores/code-sessions.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

/** A stand-in `opencode` that answers, and reports no session of its own. */
function fakeOpencode() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apx-send-bin-"));
  fs.writeFileSync(
    path.join(dir, "opencode"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "session") process.stdout.write("[]");
else process.stdout.write("peer answered\\n");
`,
    { mode: 0o755 },
  );
  fs.chmodSync(path.join(dir, "opencode"), 0o755);
  return dir;
}

async function withApi(fn) {
  const root = makeTempProject({ name: "Send Route", agents: [{ slug: "roby", role: "super" }] });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  const app = buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const binDir = fakeOpencode();
  const oldPath = process.env.PATH || "";
  process.env.PATH = `${binDir}${path.delimiter}${oldPath}`;
  try {
    await fn({ baseUrl, id, storagePath: projects.get(id).storagePath });
  } finally {
    process.env.PATH = oldPath;
    fs.rmSync(binDir, { recursive: true, force: true });
    server.close();
    cleanupTempProject(root);
  }
}

const send = (baseUrl, id, body) =>
  fetch(`${baseUrl}/api/projects/${id}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("a name nothing claims fails loudly, and says what the options were", async () => {
  await withApi(async ({ baseUrl, id }) => {
    const res = await send(baseUrl, id, { from: "tester", to: "nobody", body: "hi" });
    assert.equal(res.status, 404);
    const err = await res.json();
    assert.match(err.error, /no agent or runtime "nobody"/);
    assert.ok(err.runtimes.includes("opencode"), "the runtimes you could have meant");
    assert.ok(err.available.includes("roby"), "and the agents");
  });
});

test("the two CLIs the owner drives are refused a coding session", async () => {
  await withApi(async ({ baseUrl, id }) => {
    for (const runtime of ["claude-code", "codex"]) {
      const res = await send(baseUrl, id, { from: "tester", to: runtime, body: "hi", deliver: true, code: true });
      assert.equal(res.status, 400, `${runtime} must not open a --code session`);
      const err = await res.json();
      assert.match(err.error, new RegExp(`"${runtime}" cannot be opened as a --code peer`));
    }
    // Without --code they are ordinary peers, and the route does not object.
    const ok = await send(baseUrl, id, { from: "tester", to: "claude-code", body: "hi" });
    assert.equal(ok.status, 200);
  });
});

test("a coding exchange is mirrored into the Code module", async () => {
  await withApi(async ({ baseUrl, id, storagePath }) => {
    assert.equal(listCodeSessions(storagePath).length, 0);

    const res = await send(baseUrl, id, {
      from: "tester", to: "opencode:panel", body: "add the retry", deliver: true, code: true,
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.reply.text, "peer answered");
    assert.ok(out.reply.code_session_id, "the caller is told which session this became");

    // The Code panel is the only place a coding session is looked for. Sender is
    // the user turn; the peer that did the work is the assistant.
    const sessions = listCodeSessions(storagePath);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, out.reply.code_session_id);
    assert.equal(sessions[0].mode, "build");
    assert.match(sessions[0].title, /tester -> opencode:panel/);

    // A second turn continues the SAME session rather than opening a new one.
    await send(baseUrl, id, {
      from: "tester", to: "opencode:panel", body: "and a test", deliver: true, code: true,
    });
    const after = listCodeSessions(storagePath);
    assert.equal(after.length, 1, "one exchange, one coding session");
  });
});

test("a plain exchange leaves the Code module alone", async () => {
  await withApi(async ({ baseUrl, id, storagePath }) => {
    const res = await send(baseUrl, id, { from: "tester", to: "opencode", body: "just asking", deliver: true });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).reply.text, "peer answered");
    assert.equal(listCodeSessions(storagePath).length, 0, "talking is not a coding session");
  });
});

test("--background hands the turn back instead of holding it", async () => {
  await withApi(async ({ baseUrl, id }) => {
    const res = await send(baseUrl, id, {
      from: "tester", to: "opencode", body: "long job", deliver: true, background: true,
    });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.reply.status, "delivering");
    assert.equal(out.reply.background, true);
    // The detached run gets the hour a coding session can need, not the
    // foreground's five minutes.
    assert.equal(out.reply.timeout_s, 3600);
    assert.equal(out.reply.text, undefined, "there is no answer yet — that is the point");
  });
});
