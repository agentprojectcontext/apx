// A code session is where a coding turn stays readable. Two bugs lived here.
//
// 1. `apx exec --code` posted to the stateless /super-agent/chat/stream route,
//    so the turn existed only in the terminal that ran it — the web panel had
//    nothing to show, and the caller could not say which session it "went to",
//    because there was none. It now drives a real session and the CLI prints
//    the id.
// 2. The panel listed only the ACTIVE project's sessions, so a session started
//    from any other cwd was invisible with no hint it existed. GET
//    /api/code/sessions is the unfiltered list; each row carries the pid,
//    without which a session id is not addressable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-code-surfaces-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx"); // HOME alone is overridden by the runner's APX_HOME

const { register: registerCode } = await import("../src/host/daemon/api/code.js");
const { createCodeSession, getCodeSession, listCodeSessionsAcross } = await import(
  "#core/stores/code-sessions.js"
);
const { CHANNELS } = await import("#core/constants/channels.js");

let server;
let base;
let PROJECTS;

function makeProject(id, name) {
  const root = fs.mkdtempSync(path.join(TMP_HOME, `proj-${name}-`));
  const storage = fs.mkdtempSync(path.join(TMP_HOME, `store-${name}-`));
  fs.mkdirSync(path.join(root, ".apc"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".apc", "project.json"),
    JSON.stringify({ name, apx: "installed" })
  );
  return { id, name, path: root, storagePath: storage, logMessage: () => {} };
}

const get = async (p) => (await fetch(base + p)).json();
const post = async (p, body) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Drain an NDJSON stream into its events. */
async function streamEvents(p, body) {
  const res = await post(p, body);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

before(async () => {
  PROJECTS = [makeProject(0, "acme"), makeProject(1, "northwind")];
  const projects = {
    list: () => PROJECTS.map((p) => ({ id: p.id, name: p.name, path: p.path })),
    get: (id) => PROJECTS.find((p) => String(p.id) === String(id)) || null,
    rebuild: () => {},
  };
  const project = (req, res) => {
    const p = projects.get(req.params.pid);
    if (!p) {
      res.status(404).json({ error: "project not found" });
      return null;
    }
    return p;
  };

  const app = express();
  app.use(express.json());
  registerCode(apiRouter(express, app), {
    projects,
    project,
    config: {
      model: "mock",
      engines: {},
      super_agent: { enabled: true, model: "mock", permission_mode: "auto" },
    },
    plugins: {},
    registries: null,
  });

  server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(TMP_HOME, { recursive: true, force: true });
});

test("GET /code/sessions lists every project's sessions, newest first", async () => {
  createCodeSession(PROJECTS[0].storagePath, { projectId: 0, title: "In acme" });
  createCodeSession(PROJECTS[1].storagePath, { projectId: 1, title: "In northwind" });

  const { sessions } = await get("/api/code/sessions");
  const titles = sessions.map((s) => s.title);
  assert.ok(titles.includes("In acme"), "acme's session must be listed");
  assert.ok(titles.includes("In northwind"), "northwind's session must be listed too");

  // Newest-updated first, across projects — not grouped by project.
  const stamps = sessions.map((s) => s.updatedAt);
  assert.deepEqual(stamps, [...stamps].sort().reverse());
});

test("every aggregated row carries the pid needed to open it", async () => {
  const { sessions } = await get("/api/code/sessions");
  for (const s of sessions) {
    assert.ok(s.pid != null, `session ${s.id} must name its project`);
    assert.ok(s.projectName, `session ${s.id} must name its project for the UI`);
    // The pairing is what makes the row addressable: fetching by id alone 404s.
    const full = await get(`/api/projects/${s.pid}/code/sessions/${s.id}`);
    assert.equal(full.id, s.id);
  }
});

test("the per-project list stays scoped — it is the filter, not the default", async () => {
  const { sessions } = await get(`/api/projects/1/code/sessions`);
  assert.deepEqual(
    sessions.map((s) => s.title),
    ["In northwind"]
  );
});

test("listCodeSessionsAcross skips projects with no storage path", () => {
  const rows = listCodeSessionsAcross([
    { id: 0, name: "acme", storagePath: PROJECTS[0].storagePath },
    { id: 9, name: "ghost", storagePath: null },
  ]);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.pid === "0"));
});

test("a turn driven with channel 'code' is prompted as the terminal surface", async () => {
  const s = createCodeSession(PROJECTS[0].storagePath, { projectId: 0, title: "From the CLI" });
  // `[mock:system]` makes the engine answer with the system prompt the LOOP
  // actually built, so this asserts the channel block, not the builder.
  const events = await streamEvents(`/api/projects/0/code/sessions/${s.id}/chat/stream`, {
    prompt: "[mock:system]",
    channel: CHANNELS.CODE,
    cwd: "/path/to/somewhere",
    confirm: false,
  });
  const final = events.find((e) => e.type === "final");
  assert.ok(final, "the stream must end with a final event");
  assert.match(final.result.text, /apx exec --code/, "the code channel block must be loaded");
  assert.match(final.result.text, /\/path\/to\/somewhere/, "the caller's cwd must reach the prompt");
});

test("the web surface is still the default channel, and an unknown one cannot be named", async () => {
  const s = createCodeSession(PROJECTS[0].storagePath, { projectId: 0, title: "From the panel" });
  const noChannel = await streamEvents(`/api/projects/0/code/sessions/${s.id}/chat/stream`, {
    prompt: "[mock:system]",
    confirm: false,
  });
  assert.match(noChannel.find((e) => e.type === "final").result.text, /Web Code/);

  // A client naming any other channel gets the web surface, not that channel.
  const bogus = await streamEvents(`/api/projects/0/code/sessions/${s.id}/chat/stream`, {
    prompt: "[mock:system]",
    channel: CHANNELS.TELEGRAM,
    confirm: false,
  });
  assert.match(bogus.find((e) => e.type === "final").result.text, /Web Code/);
});

test("a CLI turn is persisted to the session, so the panel can read it back", async () => {
  const s = createCodeSession(PROJECTS[0].storagePath, { projectId: 0, title: "Readable later" });
  await streamEvents(`/api/projects/0/code/sessions/${s.id}/chat/stream`, {
    prompt: "hello from the terminal",
    channel: CHANNELS.CODE,
    confirm: false,
  });
  const stored = getCodeSession(PROJECTS[0].storagePath, s.id);
  assert.equal(stored.messages.length, 2, "the user turn and the reply are both stored");
  assert.equal(stored.messages[0].role, "user");
  assert.equal(stored.messages[1].role, "assistant");
});
