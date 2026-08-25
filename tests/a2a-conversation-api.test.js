// A2A threads must be readable through the surface the inbox points at.
//
// api/inbox.js lists a2a "group chats" under a SYNTHETIC agent slug,
// `a2a:<pairId>` — a pair exchange belongs to no single agent, so it has no
// agents/<slug>/conversations/ directory. The web opens an inbox row through
// the per-agent conversation endpoints, so every a2a row dead-ended on:
//
//   GET /api/projects/1/agents/a2a:cursor~roby/conversations → 404 agent not found
//
// Not a URL-parsing problem: the ":" reaches the handler intact, encoded or
// not — these tests pin that too, so the theory is not re-litigated.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "apx-a2a-api-"));
process.env.HOME = TMP_HOME;
process.env.APX_HOME = path.join(TMP_HOME, ".apx");

const { ProjectManager } = await import("#host/daemon/db.js");
const { buildApi } = await import("#host/daemon/api.js");
const { makeTempProject, cleanupTempProject } = await import("./_helpers.js");

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

/** Two agents talking to each other, written into the project ledger. */
function writeA2AThread(storagePath, pair = ["cursor", "roby"]) {
  const dir = path.join(storagePath, "messages");
  fs.mkdirSync(dir, { recursive: true });
  const rows = [
    { ts: "2026-08-25T10:00:00Z", channel: "a2a", direction: "out", type: "agent",
      author: pair[0], agent_slug: pair[0], body: "Roby, terminé el refactor.",
      meta: { from: pair[0], to: pair[1] } },
    { ts: "2026-08-25T10:00:30Z", channel: "a2a", direction: "in", type: "agent",
      author: pair[1], agent_slug: pair[1], body: "Gracias, lo reviso.",
      meta: { from: pair[1], to: pair[0] } },
  ];
  fs.writeFileSync(
    path.join(dir, "2026-08-25.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
}

function api(projects) {
  return buildApi({
    projects, registries: null, plugins: { get: () => null, status: () => ({}) },
    scheduler: null, version: "test", startedAt: Date.now(),
    addProjectGlobally: () => {}, config: { host: "127.0.0.1", port: 7430 }, token: "",
  });
}

async function withProject(fn) {
  const root = makeTempProject({ name: "A2A Project", agents: [{ slug: "roby", role: "super" }] });
  const projects = new ProjectManager({});
  projects.register(root);
  const id = projects.list()[0].id;
  // The a2a ledger lives in the project's STORAGE dir (~/.apx/projects/<id>),
  // which the manager resolves — not in the repo checkout.
  writeA2AThread(projects.get(id).storagePath);
  const { server, baseUrl } = await listen(api(projects));
  try {
    await fn({ baseUrl, id });
  } finally {
    server.close();
    cleanupTempProject(root);
  }
}

test("an a2a thread lists through its synthetic agent slug", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations`);
    assert.equal(res.status, 200, "used to be 404 'agent not found'");
    const list = await res.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "cursor~roby");
    assert.equal(list[0].channel, "a2a");
    assert.equal(list[0].messages, 2);
  });
});

test("the ':' in the slug survives, encoded or raw — it was never the bug", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const raw = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations`);
    const enc = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a%3Acursor~roby/conversations`);
    assert.equal(raw.status, 200);
    assert.equal(enc.status, 200);
    assert.deepEqual(await raw.json(), await enc.json());
  });
});

test("the thread body is readable, with every utterance attributed", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations/cursor~roby`);
    assert.equal(res.status, 200);
    const conv = await res.json();
    assert.equal(conv.channel, "a2a");
    assert.equal(conv.messages.length, 2);
    assert.deepEqual(conv.meta.participants, ["cursor", "roby"]);
    // Each bubble keeps its speaker, which is the whole point of a pair view.
    assert.ok(conv.messages.some((m) => JSON.stringify(m).includes("cursor")));
    assert.ok(conv.messages.some((m) => JSON.stringify(m).includes("roby")));
  });
});

test("an unknown a2a pair is 'conversation not found', not 'agent not found'", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:nadie~nada/conversations/nadie~nada`);
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, "conversation not found");
  });
});

test("renaming an a2a thread says why it cannot, instead of blaming the agent", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const res = await fetch(`${baseUrl}/api/projects/${id}/agents/a2a:cursor~roby/conversations/cursor~roby`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "nuevo" }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /a2a threads cannot be renamed/i);
  });
});

test("an ordinary agent slug is unaffected", async () => {
  await withProject(async ({ baseUrl, id }) => {
    const ok = await fetch(`${baseUrl}/api/projects/${id}/agents/roby/conversations`);
    assert.equal(ok.status, 200);
    const missing = await fetch(`${baseUrl}/api/projects/${id}/agents/fantasma/conversations`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error, "agent not found");
  });
});
