// Agent emoji + autonomy (permission-mode) fields round-trip through the API
// and persist to the .apc/agents/<slug>.md frontmatter.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  const { id } = projects.register(root);
  const app = buildApi({
    projects,
    registries: null,
    plugins: { get: () => null, status: () => ({}) },
    scheduler: null,
    version: "test",
    startedAt: Date.now(),
    addProjectGlobally: () => {},
    config: { host: "127.0.0.1", port: 7430 },
    token: "",
  });
  return { app, id };
}

const json = { "content-type": "application/json" };

test("POST persists emoji + autonomy; GET returns them", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    let r = await fetch(`${baseUrl}/projects/${id}/agents`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        slug: "roby", type: "orchestrator", area: "ops",
        emoji: "🤖", autonomy: "total",
      }),
    });
    assert.equal(r.status, 201);
    const created = await r.json();
    assert.equal(created.emoji, "🤖");
    assert.equal(created.autonomy, "total");
    assert.equal(created.type, "orchestrator");
    assert.equal(created.area, "ops");

    // Frontmatter written to the .apc file.
    const md = fs.readFileSync(path.join(root, ".apc", "agents", "roby.md"), "utf8");
    assert.match(md, /emoji: 🤖/);
    assert.match(md, /autonomy: total/);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});

test("PATCH updates autonomy and rejects an invalid value silently (keeps prior)", async () => {
  const root = makeTempProject({});
  const { app, id } = makeApp(root);
  const { server, baseUrl } = await listen(app);
  try {
    await fetch(`${baseUrl}/projects/${id}/agents`, {
      method: "POST", headers: json,
      body: JSON.stringify({ slug: "cody", autonomy: "permiso" }),
    });
    // Valid transition.
    let r = await fetch(`${baseUrl}/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ autonomy: "automatico" }),
    });
    assert.equal((await r.json()).autonomy, "automatico");
    // Bogus value is dropped — the prior value stands.
    r = await fetch(`${baseUrl}/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ autonomy: "yolo" }),
    });
    assert.equal((await r.json()).autonomy, "automatico");
    // Emoji can be cleared with an empty string.
    await fetch(`${baseUrl}/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ emoji: "🐼" }),
    });
    r = await fetch(`${baseUrl}/projects/${id}/agents/cody`, {
      method: "PATCH", headers: json, body: JSON.stringify({ emoji: "" }),
    });
    assert.equal((await r.json()).emoji, null);
  } finally {
    await new Promise((res) => server.close(res));
    cleanupTempProject(root);
  }
});
