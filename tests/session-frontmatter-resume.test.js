// Regression: the narrow /^([a-zA-Z_]+):/ key regex survived the frontmatter
// consolidation inside stores/sessions.js and stores/conversations.js, so a
// key with a digit or dash (`agent-slug`, `route_to_agent2`) resolved through
// core/sessions but silently vanished when the same file was read through
// api/runtimes.js session-resume. These tests read a session file with such
// keys through both the store and the live endpoint.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { apiRouter } from "./_helpers.js";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-resume-fm-"));
process.env.HOME = TMP_HOME;

const { register } = await import("../src/host/daemon/api/runtimes.js");
const { readSessionFrontmatter } = await import("#core/stores/sessions.js");
const { parseConversation } = await import("#core/stores/conversations.js");

const SESSION_FM =
  "---\n" +
  "title: Fix the parser\n" +
  "parent_session: x\n" +
  "agent-slug: y\n" +
  "route_to_agent2: sofia\n" +
  "---\n" +
  "\n" +
  "# Fix the parser\n";

test("readSessionFrontmatter keeps keys with digits and dashes", () => {
  const file = path.join(TMP_HOME, "unit-session.md");
  fs.writeFileSync(file, SESSION_FM);
  const r = readSessionFrontmatter(file);
  assert.deepEqual(r.fm, {
    title: "Fix the parser",
    parent_session: "x",
    "agent-slug": "y",
    route_to_agent2: "sofia",
  });
  assert.equal(r.body, "# Fix the parser\n");
});

test("parseConversation keeps keys with digits and dashes", () => {
  const { fm, turns } = parseConversation(
    "---\n" +
      "id: 2026-08-17-01\n" +
      "agent-slug: dev\n" +
      "route_to_agent2: sofia\n" +
      "---\n\n" +
      "## user — 2026-08-17T10:00:00Z\nhello\n\n"
  );
  assert.equal(fm["agent-slug"], "dev");
  assert.equal(fm.route_to_agent2, "sofia");
  assert.equal(turns.length, 1);
  assert.equal(turns[0].content, "hello");
});

test("GET /projects/:pid/sessions/:id/resume returns every frontmatter key", async () => {
  const storagePath = fs.mkdtempSync(path.join(TMP_HOME, "store-"));
  const projectPath = fs.mkdtempSync(path.join(TMP_HOME, "proj-"));
  const sessionsDir = path.join(storagePath, "agents", "dev", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, "2026-08-17-01.md"), SESSION_FM);

  const registry = [{ id: "1", name: "alpha", path: projectPath, storagePath }];
  const projects = {
    list: () => registry,
    get: (id) => registry.find((p) => String(p.id) === String(id)) || null,
  };
  const project = (req, res) => {
    const p = projects.get(req.params.pid);
    if (!p) { res.status(404).json({ error: "project not found" }); return null; }
    return p;
  };

  const app = express();
  app.use(express.json());
  register(apiRouter(express, app), {
    projects,
    registries: {},
    plugins: {},
    project,
    config: {},
  });

  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  after(() => new Promise((r) => server.close(r)));

  const res = await fetch(
    `http://127.0.0.1:${server.address().port}/api/projects/1/sessions/2026-08-17-01/resume`
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.agent, "dev");
  assert.deepEqual(body.frontmatter, {
    title: "Fix the parser",
    parent_session: "x",
    "agent-slug": "y",
    route_to_agent2: "sofia",
  });
});
