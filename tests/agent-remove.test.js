// API integration tests for QA-round fixes:
//   - agent remove (DELETE /projects/:pid/agents/:slug) — BUG-CLI-1 backs this
//   - agent-memory routes validate the slug (no 200-empty for unknown) — BUG-API-1
//   - conversations accept the super-agent pseudo-slug — `apx conversations list`
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectManager } from "#host/daemon/db.js";
import { buildApi } from "#host/daemon/api.js";
import { makeTempProject, cleanupTempProject } from "./_helpers.js";

async function listen(app) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function makeApp(root) {
  const projects = new ProjectManager({});
  projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430, super_agent: { name: "apx" } },
    token: "", // empty token → auth middleware accepts any request
  });
  return app;
}

async function pidFor(baseUrl, root) {
  const list = await (await fetch(`${baseUrl}/projects`)).json();
  const p = list.find((x) => x.path === root) || list[list.length - 1];
  return p.id;
}

test("create then DELETE an agent removes it; a second delete 404s", async () => {
  const root = makeTempProject({});
  const { server, baseUrl } = await listen(makeApp(root));
  const json = { "content-type": "application/json" };
  try {
    const pid = await pidFor(baseUrl, root);
    // create via the real path (writes .apc/agents/<slug>/agent.md)
    let r = await fetch(`${baseUrl}/projects/${pid}/agents`, {
      method: "POST", headers: json, body: JSON.stringify({ slug: "victim", role: "QA" }),
    });
    assert.equal(r.status, 201);
    // present
    r = await fetch(`${baseUrl}/projects/${pid}/agents/victim`);
    assert.equal(r.status, 200);
    // delete
    r = await fetch(`${baseUrl}/projects/${pid}/agents/victim`, { method: "DELETE" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
    // gone
    r = await fetch(`${baseUrl}/projects/${pid}/agents/victim`);
    assert.equal(r.status, 404);
    // second delete → 404 (not a silent 200)
    r = await fetch(`${baseUrl}/projects/${pid}/agents/victim`, { method: "DELETE" });
    assert.equal(r.status, 404);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("agent-memory GET/PUT 404 for an unknown slug (no 200-empty masking) — BUG-API-1", async () => {
  const root = makeTempProject({ agents: [{ slug: "real" }] });
  const { server, baseUrl } = await listen(makeApp(root));
  try {
    const pid = await pidFor(baseUrl, root);
    // real agent → 200
    let r = await fetch(`${baseUrl}/projects/${pid}/agents/real/memory`);
    assert.equal(r.status, 200);
    // unknown agent → 404 (was 200 {"body":""})
    r = await fetch(`${baseUrl}/projects/${pid}/agents/ghost/memory`);
    assert.equal(r.status, 404);
    // PUT to unknown agent → 404 (no orphan write)
    r = await fetch(`${baseUrl}/projects/${pid}/agents/ghost/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "x" }),
    });
    assert.equal(r.status, 404);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("conversations accept the super-agent pseudo-slug; unknown agents 404", async () => {
  const root = makeTempProject({ agents: [{ slug: "real" }] });
  const { server, baseUrl } = await listen(makeApp(root));
  try {
    const pid = await pidFor(baseUrl, root);
    // super-agent slug "apx" is NOT in AGENTS.md but must still resolve (→ []).
    let r = await fetch(`${baseUrl}/projects/${pid}/agents/apx/conversations`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(await r.json()));
    // a genuinely unknown agent still 404s.
    r = await fetch(`${baseUrl}/projects/${pid}/agents/ghost/conversations`);
    assert.equal(r.status, 404);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
